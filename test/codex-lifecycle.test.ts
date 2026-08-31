import assert from "node:assert/strict";
import test from "node:test";
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
});

test("non-zero unknown failures remain crashes, not guessed rate limits", () => {
  assert.equal(observeCodexOutput([JSON.stringify({ type: "error", message: "connection reset" })], 1).outcome, "crash");
});
