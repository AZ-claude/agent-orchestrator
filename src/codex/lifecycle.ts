import { spawn } from "node:child_process";

export type CodexInvocation =
  | { readonly kind: "new"; readonly prompt: string }
  | { readonly kind: "resume"; readonly sessionId: string; readonly prompt: string };

export interface CodexEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type CodexOutcome = "success" | "rate-limit" | "crash" | "failed";

export interface CodexLifecycleObservation {
  readonly events: readonly CodexEvent[];
  readonly sessionId: string | null;
  readonly outcome: CodexOutcome;
  readonly exitCode: number | null;
  readonly rateLimitRetryAt: string | null;
}

export interface CodexCommand {
  readonly command: string;
  readonly args: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The only process command used by the pilot. Shell interpretation is forbidden. */
export function codexCommand(invocation: CodexInvocation, executable = "codex"): CodexCommand {
  if (invocation.kind === "new") return { command: executable, args: ["exec", "--json", invocation.prompt] };
  if (!UUID.test(invocation.sessionId)) throw new Error("Codex session ID must be a UUID");
  return { command: executable, args: ["exec", "resume", invocation.sessionId, "--json", invocation.prompt] };
}

export function parseCodexJsonLine(line: string): CodexEvent | null {
  const text = line.trim();
  if (text === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
  return parsed as CodexEvent;
}

export function observeCodexOutput(lines: Iterable<string>, exitCode: number | null): CodexLifecycleObservation {
  const events: CodexEvent[] = [];
  let sessionId: string | null = null;
  let rateLimitRetryAt: string | null = null;
  for (const line of lines) {
    const event = parseCodexJsonLine(line);
    if (event === null) continue;
    events.push(event);
    const foundSession = explicitSessionId(event);
    if (foundSession !== null && sessionId === null) sessionId = foundSession;
    if (isRateLimitEvent(event)) rateLimitRetryAt ??= explicitRetryAt(event);
  }
  const rateLimited = events.some(isRateLimitEvent);
  const outcome: CodexOutcome = rateLimited ? "rate-limit" : exitCode === 0 ? "success" : exitCode === null ? "failed" : "crash";
  return { events, sessionId, outcome, exitCode, rateLimitRetryAt };
}

export function isRateLimitEvent(event: CodexEvent): boolean {
  const values = [event.type, event.code, event.errorType, event.status, event.message, event.error]
    .filter((value): value is string | number => typeof value === "string" || typeof value === "number")
    .map(String)
    .join(" ")
    .toLowerCase();
  return event.status === 429 || event.code === 429 || /rate[ _-]?limit|usage[ _-]?limit|quota exceeded|too many requests/.test(values);
}

export function explicitSessionId(event: CodexEvent): string | null {
  for (const key of ["session_id", "sessionId"]) {
    const value = event[key];
    if (typeof value === "string" && UUID.test(value)) return value;
  }
  if (isRecord(event.session) && typeof event.session.id === "string" && UUID.test(event.session.id)) return event.session.id;
  return null;
}

function explicitRetryAt(event: CodexEvent): string | null {
  for (const key of ["retry_at", "retryAt"]) {
    const value = event[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Small injectable adapter used by process tests and by the runner. */
export interface CodexProcess {
  readonly pid: number | undefined;
  readonly stdout: AsyncIterable<string>;
  readonly stderr: AsyncIterable<string>;
  readonly exitCode: Promise<number | null>;
  kill(signal?: NodeJS.Signals): void;
}

export function spawnCodex(invocation: CodexInvocation, cwd: string, executable = "codex"): CodexProcess {
  const command = codexCommand(invocation, executable);
  const child = spawn(command.command, [...command.args], { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  return {
    pid: child.pid,
    stdout: linesFromStream(child.stdout),
    stderr: linesFromStream(child.stderr),
    exitCode: new Promise((resolve) => child.once("exit", (code) => resolve(code))),
    kill: (signal = "SIGTERM") => child.kill(signal),
  };
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
