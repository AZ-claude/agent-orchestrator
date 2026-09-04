import assert from "node:assert/strict";
import test from "node:test";
import { runPilotFixture } from "../scripts/pilot/fixture.js";

test("disposable pilot proves SAFE, EXCLUSIVE, review/rework, restart and rate-limit paths", async () => {
  const result = await runPilotFixture();
  assert.deepEqual(result.safeDispatch, ["SAFE-A", "SAFE-B"]);
  assert.equal(result.exclusiveBlocked, true);
  assert.equal(result.reviewRounds, 2);
  assert.deepEqual(result.resumeSessions, ["123e4567-e89b-72d3-a456-426614174000:fixture rework"]);
  assert.equal(result.remoteVerification, true);
  assert.equal(result.rateLimitAction, "pause");
  assert.equal(result.rateLimitRetryAt, "2030-01-01T00:01:00.000Z");
  assert.equal(result.restartAction, "resume-luna");
  assert.equal(result.restartSessionId, "123e4567-e89b-72d3-a456-426614174000");
  assert.equal(result.scopeAccepted, true);
  assert.equal(result.scopeRejected, true);
});

test("pre-install delta pilot proves reviewed-head, recovery, plan barrier, lifecycle and authority boundaries", async () => {
  const result = await runPilotFixture();
  assert.equal(result.reviewedHeadRefused, true);
  assert.equal(result.recoveryFresh, true);
  assert.equal(result.recoveryReviewerRequired, true);
  assert.equal(result.planConflictConfirmed, true);
  assert.equal(result.barrierRefusesMerge, true);
  assert.equal(result.unrelatedSafeContinues, true);
  assert.equal(result.resumableRetained, true);
  assert.equal(result.retiredCleaned, true);
  assert.equal(result.authorityBoundary, true);
});

test("Qwen/OpenCode delta pilot proves routing, exact context preflight, durable evidence and no host mutation", async () => {
  const result = await runPilotFixture();
  assert.equal(result.autoFallbackFresh, true);
  assert.equal(result.autoFallbackLatched, true);
  assert.equal(result.autoFallbackReset, true);
  assert.equal(result.fallbackOutsideRecovery, true);
  assert.equal(result.localUnavailableFailClosed, true);
  assert.equal(result.localPreflight262144, true);
  assert.equal(result.durableProviderEvidence, true);
  assert.equal(result.noHostMutation, true);
});
