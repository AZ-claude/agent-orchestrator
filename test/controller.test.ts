import assert from "node:assert/strict";
import test from "node:test";
import { ReviewCloseController } from "../src/controller/index.js";
import { ReviewPacket } from "../src/validation/index.js";
import { assertCanMerge, assertCanChangePlan } from "../src/controller/index.js";

const packet: ReviewPacket = { taskId: "AO-11", canonicalTask: "AO-11", worktree: "/tmp/w", baseRef: "origin/main", branch: "agent/AO-11", head: "abc", pushed: true, clean: true, changedFiles: [], unexpectedFiles: [], scope: "PASS", test: { command: "npm test -- controller", exitCode: 0, pass: true }, dependencies: "PASS", branchCheck: "PASS", worktreeCheck: "PASS", baseAncestor: "PASS", acceptance: "controller" };
test("runs validation -> independent review -> deterministic merge and closes", async () => {
  const events: string[] = []; let lunaReviews = 0;
  const result = await new ReviewCloseController({ validate: async () => { events.push("validate"); return packet; }, reviewer: { review: async () => { events.push("luna-review"); lunaReviews += 1; return lunaReviews === 1 ? { result: "REWORK", reason: "add test" } : "APPROVE"; } }, mergeReviewed: async () => { events.push("merge"); return { pass: true }; }, resumeLuna: async (reason) => { events.push(`resume:${reason}`); }, setState: async (state) => { events.push(`state:${state}`); }, closeIssue: async () => { events.push("close"); } }).processWorkerDone();
  assert.equal(result.status, "approved");
  assert.equal(result.reviewRounds, 2);
  assert.deepEqual(events.filter((event) => event === "validate" || event === "luna-review" || event === "merge" || event === "close"), ["validate", "luna-review", "validate", "luna-review", "merge", "close"]);
});

test("stops on reviewer capability failure and never closes", async () => {
  let closed = false;
  const states: string[] = [];
  const result = await new ReviewCloseController({ validate: async () => packet, reviewer: { review: async () => ({ result: "CAPABILITY_UNAVAILABLE", reason: "no subagent tool" }) }, mergeReviewed: async () => ({ pass: true }), resumeLuna: async () => undefined, setState: async (state) => { states.push(state); }, closeIssue: async () => { closed = true; } }).processWorkerDone();
  assert.equal(result.status, "blocked-human"); assert.equal(closed, false);
  assert.deepEqual(states, ["reviewing", "blocked-human"]);
});

test("does not send failed machine validation to either reviewer", async () => {
  let reviewed = false;
  const result = await new ReviewCloseController({ validate: async () => ({ ...packet, clean: false }), reviewer: { review: async () => { reviewed = true; return "APPROVE"; } }, mergeReviewed: async () => ({ pass: true }), resumeLuna: async () => undefined, setState: async (state) => assert.equal(state, "blocked-human"), closeIssue: async () => undefined }).processWorkerDone();
  assert.equal(result.status, "blocked-human"); assert.equal(reviewed, false);
});

test("does not review without branch, worktree, or ancestor evidence", async () => {
  let reviewed = false;
  const result = await new ReviewCloseController({ validate: async () => ({ ...packet, baseAncestor: "FAIL" }), reviewer: { review: async () => { reviewed = true; return "APPROVE"; } }, mergeReviewed: async () => ({ pass: true }), resumeLuna: async () => undefined, setState: async (state) => assert.equal(state, "blocked-human"), closeIssue: async () => undefined }).processWorkerDone();
  assert.equal(result.status, "blocked-human");
  assert.equal(reviewed, false);
});

test("same finding triggers one fresh recovery and recovery still needs independent approval", async () => {
  let calls = 0; let recovery = false; let fresh = false; let closed = false;
  const result = await new ReviewCloseController({ validate: async () => packet, reviewer: { review: async () => { calls += 1; if (!recovery) return { result: "REWORK", reason: "same finding", findingId: "F-1" }; return "APPROVE"; } }, mergeReviewed: async () => ({ pass: true }), resumeLuna: async () => undefined, startRecovery: async () => { recovery = true; fresh = true; }, retirePrimary: async () => undefined, setState: async () => undefined, closeIssue: async () => { closed = true; } }).processWorkerDone();
  assert.equal(result.status, "approved"); assert.equal(result.recoveryUsed, true); assert.equal(fresh, true); assert.equal(calls, 3); assert.equal(closed, true);
});

test("merge gate refusal never closes an approved task", async () => {
  let closed = false;
  const result = await new ReviewCloseController({ validate: async () => packet, reviewer: { review: async () => "APPROVE" }, mergeReviewed: async () => ({ pass: false, failedGates: ["reviewed-head-equality"] }), resumeLuna: async () => undefined, setState: async () => undefined, closeIssue: async () => { closed = true; } }).processWorkerDone();
  assert.equal(result.status, "blocked-human"); assert.deepEqual(result.failedGates, ["reviewed-head-equality"]); assert.equal(closed, false);
});

test("authority matrix protects plan meaning and normal merge", () => {
  assert.doesNotThrow(() => assertCanMerge("daemon"));
  assert.throws(() => assertCanMerge("reviewer"), /cannot perform/);
  assert.doesNotThrow(() => assertCanChangePlan("terra"));
  assert.throws(() => assertCanChangePlan("worker"), /cannot perform/);
});

test("local implementation uses the same independent reviewer and deterministic merge gates", async () => {
  const resumed: string[] = [];
  let reviewed = 0;
  const result = await new ReviewCloseController({
    validate: async () => ({ ...packet, workerRole: "primary", workerProvider: "local", workerAdapter: "opencode", localModel: "ollama/qwen3.6:35b", processOutcome: "success" }),
    reviewer: { review: async () => { reviewed += 1; return reviewed === 1 ? { result: "REWORK", reason: "local fixture finding" } : "APPROVE"; } },
    mergeReviewed: async (reviewPacket) => { assert.equal(reviewPacket.workerProvider, "local"); return { pass: true }; },
    resumeWorker: async (provider, reason) => { resumed.push(`${provider}:${reason}`); },
    providerForRole: () => "local",
    setState: async () => undefined,
    closeIssue: async () => undefined,
  }).processWorkerDone();
  assert.equal(result.status, "approved");
  assert.deepEqual(resumed, ["local:local fixture finding"]);
  assert.equal(reviewed, 2);
});
