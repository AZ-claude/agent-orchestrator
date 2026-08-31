import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { codexCommand, observeCodexOutput, parseCodexJsonLine } from "../src/codex/index.js";

const sessionId = "123e4567-e89b-12d3-a456-426614174000";

test("builds explicit new and resume exec commands", () => {
  assert.deepEqual(codexCommand({ kind: "new", prompt: "do work" }), { command: "codex", args: ["exec", "--json", "do work"] });
  assert.deepEqual(codexCommand({ kind: "resume", sessionId, prompt: "fix" }), { command: "codex", args: ["exec", "resume", sessionId, "--json", "fix"] });
});

test("extracts only explicit session UUIDs and classifies known rate-limit output", () => {
  const observation = observeCodexOutput([
    JSON.stringify({ type: "session_started", session_id: sessionId }),
    JSON.stringify({ type: "error", code: "rate_limit_exceeded", retry_at: "2030-01-01T00:00:00Z" }),
    "not json",
  ], 1);
  assert.equal(observation.sessionId, sessionId);
  assert.equal(observation.outcome, "rate-limit");
  assert.equal(observation.rateLimitRetryAt, "2030-01-01T00:00:00Z");
  assert.equal(parseCodexJsonLine("{\"message\":\"no type\"}"), null);
  assert.equal(observeCodexOutput([JSON.stringify({ type: "thread.started", thread_id: "123e4567-e89b-72d3-a456-426614174000" })], 0).sessionId, "123e4567-e89b-72d3-a456-426614174000");
});

test("parses the installed Codex exec --json fixture without guessing event names", async () => {
  const output = await readFile("test/fixtures/codex/exec-success.jsonl", "utf8");
  const observation = observeCodexOutput(output.trim().split("\n"), 0);
  assert.equal(observation.sessionId, "01a056e8-ce44-70c0-a39d-dd086a7198fb");
  assert.equal(observation.outcome, "success");
});

test("non-zero unknown failures remain crashes, not guessed rate limits", () => {
  assert.equal(observeCodexOutput([JSON.stringify({ type: "error", message: "connection reset" })], 1).outcome, "failed");
  assert.equal(observeCodexOutput([JSON.stringify({ type: "turn.failed", error: { message: "You've hit your usage limit." } })], 0).outcome, "rate-limit");
});

test("spawn failure resolves as a diagnostic failed run", async () => {
  const { spawnCodex } = await import("../src/codex/index.js");
  const process = spawnCodex({ kind: "new", prompt: "noop" }, "/tmp", "definitely-not-a-real-codex");
  assert.equal(await process.exitCode, null);
});
