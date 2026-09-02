import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicScheduler, SchedulerSnapshot, activatePlanRevision, affectedByPlanConflict, beginPlanRevision, transitionState } from "../src/scheduler/index.js";
import { ManifestTask, TaskManifest } from "../src/config/index.js";

const task = (id: string, parallel: "SAFE" | "EXCLUSIVE", humanGate = false): ManifestTask => ({ id, title: id, dependsOn: [], parallel, humanGate, allowedPaths: ["src/**"], test: "npm test" });
const snapshot = (tasks: SchedulerSnapshot["tasks"], running: SchedulerSnapshot["running"] = []): SchedulerSnapshot => ({ tasks, running, maxLunaWorkers: 2 });
const item = (t: ManifestTask, state: "ready" | "running" = "ready", dependenciesClosed = true, humanGateSatisfied = false) => ({ task: t, state, dependenciesClosed, humanGateSatisfied, issueOpen: true, dependenciesAncestor: true });

test("keeps manifest order and enforces bounded SAFE concurrency", () => {
  const safe1 = task("AO-01", "SAFE"); const safe2 = task("AO-02", "SAFE");
  assert.deepEqual(new DeterministicScheduler().planDispatch(snapshot([item(safe1), item(safe2)], [{ taskId: "AO-00", parallel: "SAFE" }])), [safe1]);
});

test("serializes EXCLUSIVE and blocks unmet dependencies/gates", () => {
  const exclusive = task("AO-09", "EXCLUSIVE"); const gated = task("AO-16", "SAFE", true);
  const scheduler = new DeterministicScheduler();
  assert.deepEqual(scheduler.planDispatch(snapshot([item(exclusive), item(gated, "ready", false)])), [exclusive]);
  assert.deepEqual(scheduler.planDispatch(snapshot([item(exclusive)], [{ taskId: "AO-01", parallel: "SAFE" }])), []);
});

test("does not let a later EXCLUSIVE task bypass an earlier SAFE task", () => {
  const scheduler = new DeterministicScheduler();
  const safe = task("SAFE", "SAFE"); const safeLater = task("SAFE-LATER", "SAFE"); const exclusive = task("EXCLUSIVE", "EXCLUSIVE");
  assert.deepEqual(scheduler.planDispatch(snapshot([item(safe), item(exclusive), item(safeLater)])), [safe, safeLater]);
  assert.deepEqual(scheduler.planDispatch(snapshot([item(exclusive), item(safe)])), [exclusive]);
});

test("requires open issues and merged dependency evidence and enforces transitions", () => {
  const safe = task("SAFE", "SAFE");
  const scheduler = new DeterministicScheduler();
  assert.deepEqual(scheduler.planDispatch(snapshot([{ ...item(safe), issueOpen: false }])), []);
  assert.deepEqual(scheduler.planDispatch(snapshot([{ ...item(safe), dependenciesAncestor: false }])), []);
  assert.equal(transitionState("ready", "running"), "running");
  assert.throws(() => transitionState("blocked-human", "running"), /invalid scheduler transition/);
});

test("fails closed when issue or ancestor evidence is absent", () => {
  const safe = task("SAFE", "SAFE");
  const scheduler = new DeterministicScheduler();
  assert.deepEqual(scheduler.planDispatch(snapshot([{ task: safe, state: "ready", dependenciesClosed: true, humanGateSatisfied: false }])), []);
});

test("confirmed plan conflict pauses only its downstream set while SAFE work remains schedulable", () => {
  const conflict = task("CONFLICT", "EXCLUSIVE"); const downstream = { ...task("DOWNSTREAM", "SAFE"), dependsOn: ["CONFLICT"] }; const unrelated = task("UNRELATED", "SAFE");
  const manifest = { handoff: { id: "h", source: "docs/h.md", board: "docs/b.md", targetRepo: "/Users/eita/projects/slot", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md" }, workerCompletionContract: { independentReview: "required", reviewer: "same-session-read-only-luna-subagent", reviewerContext: "task-scope-source-head-review-packet-only", reviewerHistory: "none", onRework: "same-implementation-session-fix-validate-rereview", completion: "reviewer-approve-required-before-terra", fallback: "only-if-subagent-capability-unavailable" }, tasks: [conflict, downstream, unrelated] } as TaskManifest;
  const claim = { conflictType: "PLAN_CONFLICT" as const, taskId: "CONFLICT", canonicalRequirementRefs: ["HANDOFF"], conflictingTaskFields: ["scope"], repoEvidence: ["fixture"], whyWorkerCannotResolveWithinScope: "fixture" };
  assert.equal(beginPlanRevision(manifest, claim, "NOT_CONFIRMED"), null);
  const revision = activatePlanRevision(manifest, claim);
  assert.deepEqual(affectedByPlanConflict(manifest, "CONFLICT"), ["CONFLICT", "DOWNSTREAM"]);
  const dispatched = new DeterministicScheduler().planDispatch({ tasks: manifest.tasks.map((item) => ({ task: item, state: "ready" as const, dependenciesClosed: true, humanGateSatisfied: false, issueOpen: true, dependenciesAncestor: true, pausedByPlanRevision: revision.affectedTaskIds.includes(item.id) })), running: [], maxLunaWorkers: 2, mergeBarrierActive: true });
  assert.deepEqual(dispatched.map((item) => item.id), ["UNRELATED"]);
});
