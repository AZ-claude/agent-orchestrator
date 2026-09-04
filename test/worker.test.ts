import assert from "node:assert/strict";
import test from "node:test";
import { DurableWorkerRuntime, WorkerDispatcher, WorkerRunRouter } from "../src/worker/index.js";
import { ImplementationWorkerAdapter, WorkerRunResult } from "../src/worker/worker.js";
import { CloudWorkerAdapter } from "../src/worker/cloud.js";
import { LunaRunner } from "../src/luna/index.js";
import { CodexProcess } from "../src/codex/index.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckpointStore } from "../src/checkpoint/index.js";

function fake(provider: "cloud" | "local", results: WorkerRunResult[]): ImplementationWorkerAdapter {
  return { provider, start: async (_prompt, _worktree, role) => ({ ...(results.shift() ?? result(provider, role, "success")), role }), resume: async (_session, _prompt, _worktree, role) => result(provider, role, "success"), startRecovery: async (_evidence, _prompt, _worktree) => result(provider, "recovery", "success"), retire: async () => false };
}
function result(provider: "cloud" | "local", role: "primary" | "recovery", outcome: WorkerRunResult["outcome"], availabilityReason?: "RATE_LIMIT" | "USAGE_LIMIT" | "QUOTA_LIMIT"): WorkerRunResult {
  return { provider, adapter: provider === "cloud" ? "codex/luna" : "opencode", role, sessionId: null, pid: undefined, outcome, ...(availabilityReason === undefined ? {} : { availabilityReason }), exitCode: 0, stderr: [], logPath: "/tmp/log", fresh: true, resumable: false };
}

test("cloud/local/auto selection and auto fallback latch/reset are deterministic", async () => {
  const localConfig = { executable: "/tmp/opencode", model: "ollama/qwen3.6:35b", contextTokens: 262144, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/config" } as const;
  const cloud = fake("cloud", [result("cloud", "primary", "availability-limit", "RATE_LIMIT"), result("cloud", "primary", "success")]);
  const local = fake("local", [result("local", "primary", "success"), result("local", "primary", "success")]);
  const router = new WorkerRunRouter({ mode: "auto", primary: "cloud", recovery: "local", local: localConfig });
  const dispatcher = new WorkerDispatcher(router, { cloud, local });
  const first = await dispatcher.start("task", "/tmp", "primary");
  assert.equal(first.run.provider, "local");
  assert.equal(first.run.fresh, true);
  assert.deepEqual(first.routing.fallback, { from: "cloud", to: "local", reason: "RATE_LIMIT", latched: true });
  const second = await dispatcher.start("next", "/tmp", "primary");
  assert.equal(second.run.provider, "local");
  assert.equal((first.routing as { latchedProvider: string }).latchedProvider, "local");
  assert.equal((await dispatcher.startRecovery({ taskId: "AO-30", acceptance: "x", assumptions: [], invariants: [], branch: "b", head: "h", machineValidation: "PASS", testFailures: [], reviewerFindings: [], attemptedFixSummary: "x" }, "recover", "/tmp")).run.provider, "local");
  const nextRun = new WorkerRunRouter({ mode: "auto", primary: "cloud", recovery: "local", local: localConfig });
  assert.equal(nextRun.providerFor("primary"), "cloud");
});

test("local failure is returned without probing cloud again", async () => {
  let cloudStarts = 0;
  const cloud: ImplementationWorkerAdapter = { provider: "cloud", start: async () => { cloudStarts += 1; return result("cloud", "primary", "success"); }, resume: async () => result("cloud", "primary", "success"), startRecovery: async () => result("cloud", "recovery", "success"), retire: async () => false };
  const local = fake("local", [result("local", "primary", "spawn-error")]);
  const dispatcher = new WorkerDispatcher(new WorkerRunRouter({ mode: "local", primary: "local", recovery: "local", local: { executable: "/tmp/opencode", model: "m", contextTokens: 262144, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/c" } }), { cloud, local });
  assert.equal((await dispatcher.start("task", "/tmp", "primary")).run.outcome, "spawn-error");
  assert.equal(cloudStarts, 0);
});

test("local dispatch fails closed before process start when preflight is unavailable", async () => {
  let starts = 0;
  const local = fake("local", [result("local", "primary", "success")]);
  const originalStart = local.start;
  local.start = async (...args) => { starts += 1; return originalStart(...args); };
  const config = { mode: "local" as const, primary: "local" as const, recovery: "local" as const, local: { executable: "/tmp/opencode", model: "m", contextTokens: 262144 as const, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/c" } };
  const dispatcher = new WorkerDispatcher(new WorkerRunRouter(config), { cloud: fake("cloud", [result("cloud", "primary", "success")]), local }, async () => false);
  const dispatched = await dispatcher.start("task", "/tmp", "primary");
  assert.equal(dispatched.run.outcome, "failed");
  assert.equal(starts, 0);
});

test("ordinary cloud failure stays on cloud in auto mode", async () => {
  const local = fake("local", [result("local", "primary", "success")]);
  const cloud = fake("cloud", [result("cloud", "primary", "failed")]);
  const dispatcher = new WorkerDispatcher(new WorkerRunRouter({ mode: "auto", primary: "cloud", recovery: "cloud", local: { executable: "/tmp/opencode", model: "m", contextTokens: 262144, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/c" } }), { cloud, local });
  const run = await dispatcher.start("task", "/tmp", "primary");
  assert.equal(run.run.provider, "cloud");
  assert.equal(run.routing.latchedProvider, null);
});

test("cloud adapter preserves the existing Luna lifecycle behind the worker contract", async () => {
  const id = "123e4567-e89b-12d3-a456-426614174000";
  const processFactory = (): CodexProcess => ({ pid: 12, stdout: (async function* () { yield JSON.stringify({ type: "session_started", session_id: id }); })(), stderr: (async function* () {})(), exitCode: Promise.resolve(0), exitReason: Promise.resolve("exit"), kill: () => undefined });
  const adapter = new CloudWorkerAdapter(new LunaRunner(processFactory, { logRoot: await mkdtemp(join(tmpdir(), "ao-cloud-worker-")) }));
  const started = await adapter.start("task", "/tmp", "primary");
  const recovery = await adapter.startRecovery({ taskId: "AO-28", acceptance: "contract", assumptions: [], invariants: [], branch: "b", head: "h", machineValidation: "PASS", testFailures: [], reviewerFindings: [], attemptedFixSummary: "none" }, "recover", "/tmp");
  assert.equal(started.provider, "cloud");
  assert.equal(started.adapter, "codex/luna");
  assert.equal(started.sessionId, id);
  assert.equal(recovery.fresh, true);
});

test("routed dispatch checkpoint contains provider, role, session and fallback facts", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-worker-state-"));
  const localConfig = { executable: "/tmp/opencode", model: "ollama/qwen3.6:35b", contextTokens: 262144, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/config" } as const;
  const dispatcher = new WorkerDispatcher(new WorkerRunRouter({ mode: "auto", primary: "cloud", recovery: "local", local: localConfig }), { cloud: fake("cloud", [result("cloud", "primary", "availability-limit", "QUOTA_LIMIT")]), local: fake("local", [result("local", "primary", "success")]) });
  const checkpoints = new CheckpointStore(root);
  const base = { issueNumber: 1, taskId: "AO-32", phase: "luna" as const, attempt: 1, sessionId: null, branch: "agent/AO-32", worktree: "/tmp", pid: null, lastHead: null, retryAt: null };
  await new DurableWorkerRuntime(dispatcher, checkpoints).start({ checkpoint: base, prompt: "task", worktree: "/tmp", runId: "run-32", localModel: localConfig.model });
  const saved = await checkpoints.load("AO-32");
  assert.equal(saved?.workerProvider, "local");
  assert.equal(saved?.workerRole, "primary");
  assert.equal(saved?.workerMode, "auto");
  assert.equal(saved?.providerFallback?.reason, "QUOTA_LIMIT");
  assert.equal(saved?.runId, "run-32");
});
