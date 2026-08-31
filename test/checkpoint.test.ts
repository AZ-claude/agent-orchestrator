import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore, migrateCheckpoint } from "../src/checkpoint/index.js";

const checkpoint = { issueNumber: 1, taskId: "AO-04", phase: "luna", attempt: 1, sessionId: null, branch: "agent/AO-04", worktree: "/tmp/ao-04", pid: null, lastHead: null, retryAt: null } as const;

test("checkpoint store writes, reloads, lists, and removes atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-checkpoint-"));
  const store = new CheckpointStore(root);
  await store.save(checkpoint);
  assert.deepEqual(await store.load("AO-04"), checkpoint);
  assert.deepEqual((await store.list()).map((item) => item.taskId), ["AO-04"]);
  await store.remove("AO-04");
  assert.equal(await store.load("AO-04"), null);
});

test("supports the versioned migration envelope but rejects secret fields", () => {
  assert.deepEqual(migrateCheckpoint({ version: 1, checkpoint }), checkpoint);
  assert.throws(() => migrateCheckpoint({ version: 1, checkpoint, token: "secret" }), /unknown fields/);
});

test("serializes concurrent writes and rejects filename/task identity mismatches", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-checkpoint-concurrent-"));
  const store = new CheckpointStore(root);
  await Promise.all(Array.from({ length: 20 }, (_, index) => store.save({ ...checkpoint, attempt: index + 1 })));
  assert.equal((await store.load("AO-04"))?.taskId, "AO-04");
  await writeFile(join(root, "wrong.json"), JSON.stringify({ ...checkpoint, taskId: "AO-04" }));
  await assert.rejects(() => store.load("wrong"), /filename\/taskId mismatch/);
});
