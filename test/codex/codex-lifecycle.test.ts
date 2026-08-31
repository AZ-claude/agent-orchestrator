import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexCommand,
  observeCodexLifecycle,
  parseCodexJsonl,
} from "../../src/codex/lifecycle.js";

const fixture = async (name: string): Promise<string> =>
  readFile(
    fileURLToPath(new URL(`../../../test/fixtures/codex/${name}`, import.meta.url)),
    "utf8",
  );

const sessionId = "01a055f3-47c2-7330-82f7-a20f941827bd";

test("exec JSONL captures the first thread id and normal completion", async () => {
  const result = observeCodexLifecycle({
    stdout: await fixture("exec-success.jsonl"),
    process: { exitCode: 0 },
  });

  assert.deepEqual(result, {
    outcome: "completed",
    reason: "normal-completion",
    sessionId,
    terminalEvent: "turn.completed",
    errorMessage: null,
    rateLimit: "not-observable",
    malformedLineNumbers: [],
  });
});

test("resume uses the saved UUID and accepts only the same session", async () => {
  const command = buildCodexCommand({
    kind: "resume",
    sessionId,
    prompt: "Continue the task",
  });
  assert.deepEqual(command.args, [
    "exec",
    "resume",
    sessionId,
    "--json",
    "Continue the task",
  ]);

  const result = observeCodexLifecycle({
    stdout: await fixture("exec-success.jsonl"),
    process: { exitCode: 0 },
    expectedSessionId: sessionId,
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.sessionId, sessionId);
});

test("a different session on resume is unknown and fail-closed", async () => {
  const result = observeCodexLifecycle({
    stdout: await fixture("exec-success.jsonl"),
    process: { exitCode: 0 },
    expectedSessionId: "01a055f3-47c2-7330-82f7-a20f941827be",
  });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.reason, "session-mismatch");
});

test("a signalled process is mechanically identified as crashed", async () => {
  const result = observeCodexLifecycle({
    stdout: await fixture("started-only.jsonl"),
    process: { exitCode: null, signal: "SIGKILL" },
  });
  assert.equal(result.outcome, "crashed");
  assert.equal(result.reason, "process-signal");
  assert.equal(result.sessionId, sessionId);
});

test("an unobserved crash-like prefix without a signal remains unknown", async () => {
  const result = observeCodexLifecycle({
    stdout: await fixture("started-only.jsonl"),
    process: { exitCode: 0 },
  });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.reason, "missing-terminal-event");
});

test("rate-limit prose is not promoted to a guessed rate-limit state", async () => {
  const result = observeCodexLifecycle({
    stdout: await fixture("ambiguous-rate-limit.jsonl"),
    process: { exitCode: 1 },
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "turn-failed");
  assert.equal(result.rateLimit, "not-observable");
});

test("malformed JSONL is unknown even when the process exits successfully", () => {
  const stdout =
    '{"type":"thread.started","thread_id":"01a055f3-47c2-7330-82f7-a20f941827bd"}\nnot json\n';
  const parsed = parseCodexJsonl(stdout);
  assert.deepEqual(parsed.malformedLines.map((line) => line.lineNumber), [2]);

  const result = observeCodexLifecycle({ stdout, process: { exitCode: 0 } });
  assert.equal(result.outcome, "unknown");
  assert.equal(result.reason, "invalid-jsonl");
});

test("exec command is JSONL and does not expose --last", () => {
  const command = buildCodexCommand({ kind: "exec", prompt: "Do nothing" });
  assert.deepEqual(command.args, ["exec", "--json", "Do nothing"]);
  assert.equal(command.args.includes("--last"), false);
});
