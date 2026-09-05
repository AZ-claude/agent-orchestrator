import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalInferenceLease } from "../src/opencode/lease.js";

// Cross-language wire contract proof (kiji design doc
// docs/superpowers/specs/2026-09-02-kiji-v2-design.md §15.6). AO-40's
// cross-client-fake.test.ts only exercises this repo's own
// LocalInferenceLease class instantiated twice under different owner
// params - it never checks that the Python-side KijiLease actually
// produces (and reads) the same JSON wire format. Per the requester's
// explicit YAGNI direction, we don't spin up both languages in one
// process/subprocess E2E; instead a shared JSON fixture pair is kept
// byte-identical in both repos (kiji: tests/fixtures/lease_contract/,
// here: test/fixtures/lease-contract/) and each side proves it can read
// the other's fixture as a foreign, busy lease.

const FIXTURES_DIR = "test/fixtures/lease-contract";

test("LocalInferenceLease reads a kiji-produced owner.json fixture as a foreign busy lease", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ao-cross-lang-"));
  const path = join(dir, "shared");
  const fixtureRaw = await readFile(join(FIXTURES_DIR, "kiji-held.json"), "utf8");
  const fixture = JSON.parse(fixtureRaw) as { nonce: string; model: string; owner: string };

  const ao = new LocalInferenceLease({
    path,
    owner: "agent-orchestrator",
    model: "ollama/qwen3.8:latest",
    pid: 999999,
    processAlive: () => false,
  });

  await mkdir(path, { recursive: true });
  await writeFile(`${path}/owner.json`, fixtureRaw, "utf8");

  const result = await ao.acquire();

  assert.equal(result.evidence.status, "busy");
  assert.equal(result.evidence.owner, "kiji");
  assert.equal(result.evidence.model, "qwen3.6:35b");
  assert.equal(result.handle, undefined);

  const stillOnDisk = JSON.parse(await readFile(`${path}/owner.json`, "utf8")) as { nonce: string };
  assert.equal(stillOnDisk.nonce, fixture.nonce);
});

test("the ao-held.json fixture matches the schema this repo's own LocalInferenceLease writes", async () => {
  const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, "ao-held.json"), "utf8")) as Record<string, unknown>;

  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.owner, "agent-orchestrator");
  assert.equal(typeof fixture.model, "string");
  assert.equal(typeof fixture.pid, "number");
  assert.equal(typeof fixture.nonce, "string");
  assert.equal(typeof fixture.acquiredAt, "string");
});
