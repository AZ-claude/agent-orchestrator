import assert from "node:assert/strict";
import test from "node:test";
import { compactReviewPacket, splitCommand } from "../src/validation/index.js";

test("splits configured commands without shell evaluation", () => {
  assert.deepEqual(splitCommand("npm test -- 'manifest suite'"), ["npm", "test", "--", "manifest suite"]);
});

test("review packet is compact and exposes machine evidence", () => {
  const text = compactReviewPacket({ taskId: "AO-08", canonicalTask: "AO-08", worktree: "/tmp/w", baseRef: "origin/main", branch: "agent/AO-08", head: "abc", pushed: true, clean: true, changedFiles: ["src/validation/validator.ts"], unexpectedFiles: [], scope: "PASS", test: { command: "npm test -- validation", exitCode: 0, pass: true }, dependencies: "PASS", acceptance: "validator" });
  assert.match(text, /Push: PASS/);
  assert.match(text, /Scope check: PASS/);
  assert.doesNotMatch(text, /token|secret/i);
});
