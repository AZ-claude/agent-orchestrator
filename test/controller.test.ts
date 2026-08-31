import assert from "node:assert/strict";
import test from "node:test";
import { ReviewCloseController } from "../src/controller/index.js";
import { ReviewPacket } from "../src/validation/index.js";

const packet: ReviewPacket = { taskId: "AO-11", canonicalTask: "AO-11", worktree: "/tmp/w", baseRef: "origin/main", branch: "agent/AO-11", head: "abc", pushed: true, clean: true, changedFiles: [], unexpectedFiles: [], scope: "PASS", test: { command: "npm test -- controller", exitCode: 0, pass: true }, dependencies: "PASS", branchCheck: "PASS", worktreeCheck: "PASS", baseAncestor: "PASS", acceptance: "controller" };
test("runs validation -> independent review -> Terra and closes only after remote verification", async () => {
  const events: string[] = []; let lunaReviews = 0; let terraReviews = 0;
  const result = await new ReviewCloseController({ validate: async () => { events.push("validate"); return packet; }, reviewer: { review: async () => { events.push("luna-review"); lunaReviews += 1; return lunaReviews === 1 ? { result: "REWORK", reason: "add test" } : "APPROVE"; } }, terra: { review: async () => { events.push("terra"); terraReviews += 1; return terraReviews === 1 ? { result: "REWORK", reason: "fix semantics" } : { result: "APPROVE" }; } }, resumeLuna: async (reason) => { events.push(`resume:${reason}`); }, setState: async (state) => { events.push(`state:${state}`); }, verifyRemoteBaseContains: async () => { events.push("verify-merge"); return true; }, closeIssue: async () => { events.push("close"); } }).processWorkerDone();
  assert.equal(result.status, "approved");
  assert.equal(result.reviewRounds, 3);
  assert.deepEqual(events.filter((event) => event === "validate" || event === "luna-review" || event === "terra" || event === "close"), ["validate", "luna-review", "validate", "luna-review", "terra", "validate", "luna-review", "terra", "close"]);
});

test("stops on reviewer capability failure and never closes", async () => {
  let closed = false;
  const states: string[] = [];
  const result = await new ReviewCloseController({ validate: async () => packet, reviewer: { review: async () => ({ result: "CAPABILITY_UNAVAILABLE", reason: "no subagent tool" }) }, terra: { review: async () => ({ result: "APPROVE" }) }, resumeLuna: async () => undefined, setState: async (state) => { states.push(state); }, verifyRemoteBaseContains: async () => true, closeIssue: async () => { closed = true; } }).processWorkerDone();
  assert.equal(result.status, "blocked-human"); assert.equal(closed, false);
  assert.deepEqual(states, ["reviewing", "blocked-human"]);
});

test("does not send failed machine validation to either reviewer", async () => {
  let reviewed = false;
  const result = await new ReviewCloseController({ validate: async () => ({ ...packet, clean: false }), reviewer: { review: async () => { reviewed = true; return "APPROVE"; } }, terra: { review: async () => { reviewed = true; return { result: "APPROVE" }; } }, resumeLuna: async () => undefined, setState: async (state) => assert.equal(state, "blocked-human"), verifyRemoteBaseContains: async () => true, closeIssue: async () => undefined }).processWorkerDone();
  assert.equal(result.status, "blocked-human"); assert.equal(reviewed, false);
});
