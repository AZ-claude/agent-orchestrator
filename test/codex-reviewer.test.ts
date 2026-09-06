import assert from "node:assert/strict";
import test from "node:test";
import { CodexReadOnlyReviewer, ReadOnlyReviewerInvocation, parseReview } from "../src/controller/index.js";
import { ReviewPacket } from "../src/validation/index.js";

const packet: ReviewPacket = {
  taskId: "AO-49",
  canonicalTask: "AO-49 concrete independent reviewer",
  worktree: "/tmp/reviewer-worktree",
  baseRef: "origin/main",
  branch: "agent/AO-49",
  head: "1234567890abcdef",
  pushed: true,
  clean: true,
  changedFiles: ["src/controller/codex-reviewer.ts"],
  unexpectedFiles: [],
  scope: "PASS",
  test: { command: "npm test -- codex-reviewer", exitCode: 0, pass: true },
  dependencies: "PASS",
  branchCheck: "PASS",
  worktreeCheck: "PASS",
  baseAncestor: "PASS",
  acceptance: "Concrete reviewer is independent and read-only",
  assumptions: ["Review only committed HEAD"],
  invariants: ["No code writes"],
  // This deliberately must not cross the reviewer boundary.
  previousRework: "implementation conversation history: private worker reasoning",
};

test("concrete reviewer starts a fresh sandboxed read-only process with only packet evidence", async () => {
  let invocation: ReadOnlyReviewerInvocation | undefined;
  const reviewer = new CodexReadOnlyReviewer("codex-test", async (received) => {
    invocation = received;
    return { stdout: '{"result":"APPROVE"}' };
  });

  assert.equal(await reviewer.review(packet), "APPROVE");
  assert.deepEqual(invocation?.args.slice(0, 3), ["exec", "--sandbox", "read-only"]);
  assert.equal(invocation?.cwd, packet.worktree);
  const prompt = invocation?.args.at(-1) ?? "";
  assert.match(prompt, /Source HEAD: 1234567890abcdef/);
  assert.match(prompt, /READ-ONLY CONTRACT/);
  assert.doesNotMatch(prompt, /implementation conversation history/);
  assert.doesNotMatch(prompt, /--resume|sessionId|resume implementation/i);
  assert.doesNotMatch(prompt, /Previous rework:/);
});

test("concrete reviewer returns structured rework and plan-conflict controller results", () => {
  assert.deepEqual(parseReview('{"result":"REWORK","reason":"add a focused test","findingId":"F-49"}'), { result: "REWORK", reason: "add a focused test", findingId: "F-49" });
  const claim = { conflictType: "PLAN_CONFLICT", taskId: "AO-49", canonicalRequirementRefs: ["HANDOFF"], conflictingTaskFields: ["reviewer"], repoEvidence: ["adapter absent"], whyWorkerCannotResolveWithinScope: "transport is required" };
  assert.deepEqual(parseReview(`progress\n${JSON.stringify({ result: "PLAN_CONFLICT", claim })}`), { result: "PLAN_CONFLICT", claim });
  assert.deepEqual(parseReview(JSON.stringify({ result: "PLAN_CONFLICT_CONFIRMED", claim })), { result: "PLAN_CONFLICT_CONFIRMED", claim });
});

test("missing capability and malformed reviewer output fail closed", async () => {
  const unavailable = new CodexReadOnlyReviewer("missing-codex", async () => { throw new Error("not installed"); });
  assert.deepEqual(await unavailable.review(packet), { result: "CAPABILITY_UNAVAILABLE", reason: "read-only reviewer unavailable: not installed" });
  const malformed = parseReview('{"result":"APPROVE","reason":"extra field is rejected"}');
  assert.notEqual(malformed, "APPROVE");
  if (typeof malformed !== "string") assert.equal(malformed.result, "CAPABILITY_UNAVAILABLE");
});
