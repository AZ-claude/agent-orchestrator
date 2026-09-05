import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AO_LOCAL_MODEL, REQUIRED_LOCAL_CONTEXT } from "../src/config/index.js";
import { LocalInferenceLease } from "../src/opencode/lease.js";

test("AO-40 cross-client fake proves one shared holder and fixed model ownership", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ao-cross-client-")), "shared");
  const ao = new LocalInferenceLease({ path, owner: "agent-orchestrator", model: AO_LOCAL_MODEL, pid: 1101 });
  const kiji = new LocalInferenceLease({ path, owner: "kiji", model: "qwen3.6:35b", pid: 1102 });
  const aoHeld = await ao.acquire();
  const kijiBlocked = await kiji.acquire();
  assert.equal(aoHeld.evidence.status, "acquired");
  assert.equal(aoHeld.evidence.model, AO_LOCAL_MODEL);
  assert.equal(kijiBlocked.evidence.status, "busy");
  assert.equal(kijiBlocked.evidence.owner, "agent-orchestrator");
  assert.equal(kijiBlocked.evidence.model, AO_LOCAL_MODEL);
  assert.equal(REQUIRED_LOCAL_CONTEXT, 262144);
  await aoHeld.handle?.release();

  const kijiHeld = await kiji.acquire();
  assert.equal(kijiHeld.evidence.status, "acquired");
  assert.equal(kijiHeld.evidence.model, "qwen3.6:35b");
  await kijiHeld.handle?.release();
});
