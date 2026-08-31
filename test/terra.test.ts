import assert from "node:assert/strict";
import test from "node:test";
import { parseTerraResult, TerraReviewRunner } from "../src/terra/index.js";
import { CodexProcess } from "../src/codex/index.js";

test("accepts only schema-valid Terra outcomes", () => {
  assert.deepEqual(parseTerraResult('{"result":"APPROVE"}'), { result: "APPROVE" });
  assert.deepEqual(parseTerraResult('{"result":"REWORK","reason":"fix test"}'), { result: "REWORK", reason: "fix test" });
  assert.throws(() => parseTerraResult("APPROVE"), /JSON/);
  assert.throws(() => parseTerraResult('{"result":"NOPE"}'), /validation failed/);
});

test("Terra runner resumes a saved session and sends a compact packet", async () => {
  let prompt = "";
  const process: CodexProcess = { pid: 9, stdout: (async function* () { yield '{"result":"APPROVE"}'; })(), stderr: (async function* () {})(), exitCode: Promise.resolve(0), kill: () => undefined };
  const packet = { taskId: "AO-10", canonicalTask: "AO-10", worktree: "/tmp/w", baseRef: "origin/main", branch: "agent/AO-10", head: "abc", pushed: true, clean: true, changedFiles: [], unexpectedFiles: [], scope: "PASS", test: { command: "npm test -- terra", exitCode: 0, pass: true }, dependencies: "PASS", acceptance: "terra" } as const;
  const runner = new TerraReviewRunner((invocation) => { prompt = invocation.prompt; return process; });
  const result = await runner.review("123e4567-e89b-12d3-a456-426614174000", packet, "/tmp");
  assert.equal(result.result.result, "APPROVE");
  assert.match(prompt, /Task: AO-10/);
});
