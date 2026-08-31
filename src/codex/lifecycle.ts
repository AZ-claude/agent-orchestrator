/**
 * Conservative adapter for the JSONL emitted by codex-cli 0.151.0.
 *
 * The installed CLI exposes lifecycle events, but no typed rate-limit event
 * or error code. The adapter therefore never infers rate limits from prose.
 * A future CLI contract must add an observed fixture before that state can
 * become machine-detectable.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LIFECYCLE_EVENT_TYPES = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "error",
]);

const ITEM_EVENT_PATTERN = /^item\.(started|updated|completed)$/;

export const OBSERVED_CODEX_CLI_VERSION = "0.151.0";

export type CodexInvocation =
  | { kind: "exec"; prompt: string }
  | { kind: "resume"; sessionId: string; prompt: string };

export interface CodexCommand {
  executable: string;
  args: readonly string[];
}

export interface CodexProcessResult {
  /** Null means the process did not exit normally (for example, a signal). */
  exitCode: number | null;
  signal?: string | null;
}

export interface ParsedCodexJsonl {
  events: readonly Record<string, unknown>[];
  malformedLines: readonly { lineNumber: number; text: string }[];
}

export type CodexLifecycleOutcome =
  | "completed"
  | "failed"
  | "crashed"
  | "unknown";

export type CodexLifecycleReason =
  | "normal-completion"
  | "turn-failed"
  | "stream-error"
  | "process-signal"
  | "invalid-jsonl"
  | "invalid-session-id"
  | "session-mismatch"
  | "unexpected-event"
  | "missing-terminal-event"
  | "non-zero-exit";

export interface CodexLifecycleObservation {
  outcome: CodexLifecycleOutcome;
  reason: CodexLifecycleReason;
  sessionId: string | null;
  terminalEvent: "turn.completed" | "turn.failed" | "error" | null;
  errorMessage: string | null;
  /** Rate limits are not represented in the observed v0.151.0 JSONL contract. */
  rateLimit: "not-observable";
  malformedLineNumbers: readonly number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function hasValidUsage(event: Record<string, unknown>): boolean {
  const usage = event.usage;
  if (!isRecord(usage)) return false;

  return (
    isNonNegativeInteger(usage.input_tokens) &&
    isNonNegativeInteger(usage.cached_input_tokens) &&
    isNonNegativeInteger(usage.cache_write_input_tokens) &&
    isNonNegativeInteger(usage.output_tokens) &&
    isNonNegativeInteger(usage.reasoning_output_tokens)
  );
}

function errorMessage(event: Record<string, unknown>): string | null {
  if (event.type === "error") {
    return typeof event.message === "string" && event.message.length > 0
      ? event.message
      : null;
  }

  const error = event.error;
  if (!isRecord(error)) return null;
  return typeof error.message === "string" && error.message.length > 0
    ? error.message
    : null;
}

/** Parse stdout only; stderr is a separate process observation. */
export function parseCodexJsonl(stdout: string): ParsedCodexJsonl {
  const events: Record<string, unknown>[] = [];
  const malformedLines: { lineNumber: number; text: string }[] = [];

  stdout.split(/\r?\n/).forEach((line, index) => {
    const text = line.trim();
    if (text.length === 0) return;

    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value) || typeof value.type !== "string") {
        malformedLines.push({ lineNumber: index + 1, text });
        return;
      }
      events.push(value);
    } catch {
      malformedLines.push({ lineNumber: index + 1, text });
    }
  });

  return { events, malformedLines };
}

/**
 * Build only the explicit exec and saved-session resume forms. `--last` is
 * intentionally unavailable because it can select another task's session.
 */
export function buildCodexCommand(
  invocation: CodexInvocation,
  executable = "codex",
): CodexCommand {
  if (invocation.prompt.length === 0) {
    throw new Error("Codex prompt must not be empty");
  }

  if (invocation.kind === "exec") {
    return { executable, args: ["exec", "--json", invocation.prompt] };
  }

  if (!isUuid(invocation.sessionId)) {
    throw new Error("Codex resume requires a UUID session id");
  }

  return {
    executable,
    args: ["exec", "resume", invocation.sessionId, "--json", invocation.prompt],
  };
}

/**
 * Evaluate a completed child process without interpreting natural-language
 * output. Any unrecognised or incomplete lifecycle is `unknown`.
 */
export function observeCodexLifecycle(input: {
  stdout: string;
  process: CodexProcessResult;
  expectedSessionId?: string;
}): CodexLifecycleObservation {
  const parsed = parseCodexJsonl(input.stdout);
  const malformedLineNumbers = parsed.malformedLines.map((line) => line.lineNumber);
  const events = parsed.events;
  const first = events[0];
  const sessionId = first?.type === "thread.started" ? first.thread_id : null;

  const unknown = (
    reason: CodexLifecycleReason,
    terminalEvent: CodexLifecycleObservation["terminalEvent"] = null,
    errorMessage: string | null = null,
  ): CodexLifecycleObservation => ({
    outcome: "unknown",
    reason,
    sessionId: isUuid(sessionId) ? sessionId : null,
    terminalEvent,
    errorMessage,
    rateLimit: "not-observable",
    malformedLineNumbers,
  });

  if (input.process.signal) {
    return {
      outcome: "crashed",
      reason: "process-signal",
      sessionId: isUuid(sessionId) ? sessionId : null,
      terminalEvent: null,
      errorMessage: null,
      rateLimit: "not-observable",
      malformedLineNumbers,
    };
  }

  if (malformedLineNumbers.length > 0) return unknown("invalid-jsonl");
  if (!first || first.type !== "thread.started" || !isUuid(first.thread_id)) {
    return unknown("invalid-session-id");
  }
  if (
    input.expectedSessionId !== undefined &&
    (!isUuid(input.expectedSessionId) || first.thread_id !== input.expectedSessionId)
  ) {
    return unknown("session-mismatch");
  }

  let terminalIndex = -1;
  let terminalEvent: CodexLifecycleObservation["terminalEvent"] = null;
  let terminalError: string | null = null;
  let sawTurnStarted = false;
  let invalidReason: CodexLifecycleReason | null = null;

  events.forEach((event, index) => {
    if (invalidReason) return;
    const type = typeof event.type === "string" ? event.type : "";

    if (index > 0 && type === "thread.started") {
      invalidReason = "unexpected-event";
      return;
    }
    if (!LIFECYCLE_EVENT_TYPES.has(type) && !ITEM_EVENT_PATTERN.test(type)) {
      invalidReason = "unexpected-event";
      return;
    }
    if (type === "turn.started") {
      if (sawTurnStarted || terminalIndex !== -1) invalidReason = "unexpected-event";
      sawTurnStarted = true;
      return;
    }
    if (type === "turn.completed") {
      if (!sawTurnStarted || terminalIndex !== -1 || !hasValidUsage(event)) {
        invalidReason = "unexpected-event";
        return;
      }
      terminalIndex = index;
      terminalEvent = "turn.completed";
      return;
    }
    if (type === "turn.failed" || type === "error") {
      if (terminalIndex !== -1) {
        invalidReason = "unexpected-event";
        return;
      }
      const message = errorMessage(event);
      if (message === null) {
        invalidReason = "unexpected-event";
        return;
      }
      terminalIndex = index;
      terminalEvent = type;
      terminalError = message;
    }
  });

  if (invalidReason) return unknown(invalidReason, terminalEvent, terminalError);
  if (terminalIndex === -1) return unknown("missing-terminal-event");
  if (terminalIndex !== events.length - 1) {
    return unknown("unexpected-event", terminalEvent, terminalError);
  }

  if (terminalEvent === "turn.completed") {
    if (input.process.exitCode === 0) {
      return {
        outcome: "completed",
        reason: "normal-completion",
        sessionId: first.thread_id,
        terminalEvent,
        errorMessage: null,
        rateLimit: "not-observable",
        malformedLineNumbers,
      };
    }
    return unknown("non-zero-exit", terminalEvent);
  }

  return {
    outcome: "failed",
    reason: terminalEvent === "turn.failed" ? "turn-failed" : "stream-error",
    sessionId: first.thread_id,
    terminalEvent,
    errorMessage: terminalError,
    rateLimit: "not-observable",
    malformedLineNumbers,
  };
}
