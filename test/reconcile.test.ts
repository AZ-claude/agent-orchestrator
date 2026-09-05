import assert from "node:assert/strict";
import test from "node:test";
import { canCleanupSession, cleanupSessions, reconcile, reconcileStaleLocalLease, reconcileWithLocalLease, synchronizePlanRevision } from "../src/reconcile/index.js";
import { Checkpoint } from "../src/config/index.js";

const checkpoint: Checkpoint = { issueNumber: 1, taskId: "AO-12", phase: "luna", attempt: 1, sessionId: "123e4567-e89b-12d3-a456-426614174000", branch: "agent/AO-12", worktree: "/tmp/w", pid: null, lastHead: null, retryAt: null };
test("reconciles crash, rate-limit, and already-completed cases deterministically", () => {
  const base = { checkpoint, processAlive: false, pushedHead: false, sessionExists: true, rateLimited: false, now: new Date("2030-01-01T00:00:00Z") };
  assert.deepEqual(reconcile({ ...base, issueState: "running" }, 60_000), { kind: "resume-luna" });
  assert.equal(reconcile({ ...base, issueState: "running", rateLimited: true }, 60_000).kind, "pause");
  assert.equal(reconcile({ ...base, issueState: "running", checkpoint: { ...checkpoint, processOutcome: "lease-busy" } }, 60_000).kind, "wait-local-lease");
  assert.equal(reconcile({ ...base, issueState: "closed", pushedHead: true }, 60_000).kind, "skip-completed");
  assert.equal(reconcile({ ...base, issueState: "running", pushedHead: true }, 60_000).kind, "validate");
});

test("stale lease reconciliation delegates only the owner-scoped release operation", async () => {
  let calls = 0;
  assert.equal(await reconcileStaleLocalLease({ releaseStaleOwner: async () => { calls += 1; return true; } }), "released");
  assert.equal(calls, 1);
  assert.equal((await reconcileWithLocalLease({ checkpoint: { ...checkpoint, processOutcome: "lease-busy" }, issueState: "running", processAlive: false, pushedHead: false, sessionExists: false, rateLimited: false, now: new Date("2030-01-01T00:00:00Z") }, 60_000, { releaseStaleOwner: async () => true })).kind, "wait-local-lease");
});

test("retains resumable sessions, cleans retired sessions, and requires synchronized revision evidence", () => {
  const resumable = { sessionId: "a", taskId: "A", role: "primary" as const, lifecycle: "RESUMABLE" as const }; const retired = { sessionId: "b", taskId: "B", role: "recovery" as const, lifecycle: "RETIRED" as const };
  assert.equal(canCleanupSession(resumable), false); assert.deepEqual(cleanupSessions([resumable, retired]), [retired]);
  assert.equal(synchronizePlanRevision({ boardDigest: "d", manifestDigest: "d", expectedDigest: "d", directive: "restart" }), "restart");
  assert.throws(() => synchronizePlanRevision({ boardDigest: "d", manifestDigest: "x", expectedDigest: "d", directive: "resume" }), /mismatch/);
});
