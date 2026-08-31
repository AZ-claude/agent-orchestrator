import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicScheduler, SchedulerSnapshot } from "../src/scheduler/index.js";
import { ManifestTask } from "../src/config/index.js";

const task = (id: string, parallel: "SAFE" | "EXCLUSIVE", humanGate = false): ManifestTask => ({ id, title: id, dependsOn: [], parallel, humanGate, allowedPaths: ["src/**"], test: "npm test" });
const snapshot = (tasks: SchedulerSnapshot["tasks"], running: SchedulerSnapshot["running"] = []): SchedulerSnapshot => ({ tasks, running, maxLunaWorkers: 2 });
const item = (t: ManifestTask, state: "ready" | "running" = "ready", dependenciesClosed = true, humanGateSatisfied = false) => ({ task: t, state, dependenciesClosed, humanGateSatisfied });

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
