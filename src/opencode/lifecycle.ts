import { spawn } from "node:child_process";

export type OpenCodeInvocation =
  | { readonly kind: "new"; readonly prompt: string; readonly model: string }
  | { readonly kind: "resume"; readonly sessionId: string; readonly prompt: string; readonly model: string };

export interface OpenCodeEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type OpenCodeOutcome = "success" | "availability-limit" | "crash" | "failed" | "spawn-error";
export type AvailabilityLimitReason = "RATE_LIMIT" | "USAGE_LIMIT" | "QUOTA_LIMIT";

export interface OpenCodeLifecycleObservation {
  readonly events: readonly OpenCodeEvent[];
  readonly sessionId: string | null;
  readonly outcome: OpenCodeOutcome;
  readonly availabilityReason?: AvailabilityLimitReason;
  readonly exitCode: number | null;
  readonly exitReason: "exit" | "signal" | "spawn-error";
}

export interface OpenCodeCommand { readonly command: string; readonly args: readonly string[]; }

/** Exact non-interactive contract observed from OpenCode 1.18.23 help. */
export function openCodeCommand(invocation: OpenCodeInvocation, executable = "opencode"): OpenCodeCommand {
  if (invocation.kind === "new") return { command: executable, args: ["run", "--format", "json", "--model", invocation.model, invocation.prompt] };
  if (!isSafeSessionId(invocation.sessionId)) throw new Error("OpenCode session ID is invalid");
  return { command: executable, args: ["run", "--format", "json", "--model", invocation.model, "--session", invocation.sessionId, invocation.prompt] };
}

export function parseOpenCodeJsonLine(line: string): OpenCodeEvent | null {
  const text = line.trim();
  if (text === "") return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
    return parsed as OpenCodeEvent;
  } catch {
    return null;
  }
}

export function observeOpenCodeOutput(lines: Iterable<string>, exitCode: number | null, exitReason: "exit" | "signal" | "spawn-error" = "exit"): OpenCodeLifecycleObservation {
  const events: OpenCodeEvent[] = [];
  let sessionId: string | null = null;
  let availabilityReason: AvailabilityLimitReason | undefined;
  for (const line of lines) {
    const event = parseOpenCodeJsonLine(line);
    if (event === null) continue;
    events.push(event);
    sessionId ??= explicitSessionId(event);
    availabilityReason ??= explicitAvailabilityLimit(event);
  }
  const failed = events.some(isFailureEvent);
  const outcome: OpenCodeOutcome = availabilityReason !== undefined
    ? "availability-limit"
    : exitReason === "spawn-error"
      ? "spawn-error"
      : exitReason === "signal" || exitCode === null
        ? "crash"
        : failed || exitCode !== 0
          ? "failed"
          : "success";
  return { events, sessionId, outcome, ...(availabilityReason === undefined ? {} : { availabilityReason }), exitCode, exitReason };
}

export function explicitSessionId(event: OpenCodeEvent): string | null {
  for (const key of ["sessionID", "sessionId", "session_id", "threadID", "threadId"]) {
    const value = event[key];
    if (typeof value === "string" && isSafeSessionId(value)) return value;
  }
  if (isRecord(event.session) && typeof event.session.id === "string" && isSafeSessionId(event.session.id)) return event.session.id;
  return null;
}

function explicitAvailabilityLimit(event: OpenCodeEvent): AvailabilityLimitReason | undefined {
  const values = collectStrings({ type: event.type, code: event.code, status: event.status, errorType: event.errorType, message: event.message, error: event.error }).join(" ").toLowerCase();
  if (event.status === 429 || event.code === 429 || /\b429\b|rate[ _-]?limit/.test(values)) return "RATE_LIMIT";
  if (/usage[ _-]?limit/.test(values)) return "USAGE_LIMIT";
  if (/quota([ _-]?exceeded|[ _-]?limit)?/.test(values)) return "QUOTA_LIMIT";
  return undefined;
}

function isFailureEvent(event: OpenCodeEvent): boolean {
  return event.type === "error" || event.type.endsWith(".error") || event.type === "turn.failed" || event.status === "error" || event.status === "failed";
}

function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.entries(value).flatMap(([key, nested]) => [key, ...collectStrings(nested)]);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface OpenCodeProcess {
  readonly pid: number | undefined;
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly exitCode: Promise<number | null>;
  readonly exitReason: Promise<"exit" | "signal" | "spawn-error">;
  kill(signal?: NodeJS.Signals): void;
}

export function spawnOpenCode(invocation: OpenCodeInvocation, cwd: string, executable = "opencode"): OpenCodeProcess {
  const command = openCodeCommand(invocation, executable);
  const child = spawn(command.command, [...command.args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  let resolveExit: ((code: number | null) => void) | undefined;
  let resolveReason: ((reason: "exit" | "signal" | "spawn-error") => void) | undefined;
  const exitCode = new Promise<number | null>((resolve) => { resolveExit = resolve; });
  const exitReason = new Promise<"exit" | "signal" | "spawn-error">((resolve) => { resolveReason = resolve; });
  child.once("exit", (code, signal) => { resolveExit?.(code); resolveReason?.(signal === null ? "exit" : "signal"); });
  child.once("error", () => { resolveExit?.(null); resolveReason?.("spawn-error"); });
  return { pid: child.pid, stdout: linesFromStream(child.stdout), stderr: linesFromStream(child.stderr), exitCode, exitReason, kill: (signal = "SIGTERM") => child.kill(signal) };
}

async function* linesFromStream(stream: NodeJS.ReadableStream | null): AsyncIterable<string> {
  if (stream === null) return;
  let buffer = "";
  for await (const chunk of stream) {
    buffer += String(chunk);
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    yield* parts;
  }
  if (buffer !== "") yield buffer;
}
