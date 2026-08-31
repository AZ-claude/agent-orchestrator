import assert from "node:assert/strict";
import test from "node:test";
import { runPilotFixture } from "../scripts/pilot/fixture.js";

test("disposable pilot proves SAFE, EXCLUSIVE, review/rework, restart and rate-limit paths", async () => {
  const result = await runPilotFixture();
  assert.deepEqual(result.safeDispatch, ["SAFE-A", "SAFE-B"]);
  assert.equal(result.exclusiveBlocked, true);
  assert.equal(result.reviewRounds, 2);
  assert.equal(result.rateLimitAction, "pause");
  assert.equal(result.restartAction, "resume-luna");
});
