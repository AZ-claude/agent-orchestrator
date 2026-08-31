import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexProcess } from "../src/codex/index.js";
import { LunaRunner } from "../src/luna/index.js";

const id = "123e4567-e89b-12d3-a456-426614174000";
function fakeProcess(lines: string[], code: number): CodexProcess {
  return { pid: 42, stdout: (async function* () { yield* lines; })(), stderr: (async function* () { yield "stderr"; })(), exitCode: Promise.resolve(code), exitReason: Promise.resolve("exit"), kill: () => undefined };
}

function failedProcess(): CodexProcess {
  return fakeProcess([JSON.stringify({ type: "turn.failed", error: "deterministic failure" })], 1);
}

test("runner captures JSONL, PID/session and exit outcome", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "ao-luna-log-"));
  const runner = new LunaRunner(() => fakeProcess([JSON.stringify({ type: "session_started", session_id: id })], 0), { logRoot });
  const result = await runner.start("prompt", "/tmp/worktree");
  assert.equal(result.pid, 42);
  assert.equal(result.sessionId, id);
  assert.equal(result.outcome, "success");
  assert.deepEqual(result.stderr, ["stderr"]);
  assert.match(await readFile(result.logPath, "utf8"), /session_started/);
  assert.equal(result.recoveryEvent, "success");
});

test("resume uses the saved session through the same runner", async () => {
  let seen: unknown;
  const runner = new LunaRunner((invocation) => { seen = invocation; return fakeProcess([], 1); }, { logRoot: await mkdtemp(join(tmpdir(), "ao-luna-log-")), maxResumeAttempts: 2 });
  const result = await runner.resumeWithRetry(id, "rework", "/tmp");
  assert.deepEqual(seen, { kind: "resume", sessionId: id, prompt: "rework" });
  assert.equal(result.attempt, 2);
  assert.throws(() => runner.resume(id, "too many", "/tmp", 3), /between 1 and 2/);
});

test("does not retry deterministic failures", async () => {
  let starts = 0;
  const runner = new LunaRunner(() => { starts += 1; return failedProcess(); }, { logRoot: await mkdtemp(join(tmpdir(), "ao-luna-log-")), maxResumeAttempts: 2 });
  const result = await runner.resumeWithRetry(id, "rework", "/tmp");
  assert.equal(result.outcome, "failed");
  assert.equal(result.attempt, 1);
  assert.equal(starts, 1);
});
