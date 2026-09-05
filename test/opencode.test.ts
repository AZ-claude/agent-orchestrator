import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeProcess, openCodeCommand, observeOpenCodeOutput } from "../src/opencode/lifecycle.js";
import { OpenCodeWorkerAdapter } from "../src/opencode/runner.js";
import { preflightLocalWorker } from "../src/opencode/preflight.js";
import { LocalInferenceLease } from "../src/opencode/lease.js";

const sessionId = "ses_fixture_01";
const config = { executable: "/tmp/opencode", model: "ollama/qwen3.8:latest", contextTokens: 262144, workdir: "/tmp/worktree", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/opencode.jsonc", leasePath: "/tmp/agent-orchestrator-ollama.lease" } as const;

function fakeProcess(lines: string[], code: number, reason: "exit" | "signal" | "spawn-error" = "exit"): OpenCodeProcess {
  return { pid: 77, stdout: (async function* () { yield* lines; })(), stderr: (async function* () { yield "diagnostic"; })(), exitCode: Promise.resolve(code), exitReason: Promise.resolve(reason), kill: () => undefined };
}

test("builds shell-free fresh and supported resume invocations", () => {
  assert.deepEqual(openCodeCommand({ kind: "new", model: config.model, prompt: "do work" }), { command: "opencode", args: ["run", "--format", "json", "--model", config.model, "do work"] });
  assert.deepEqual(openCodeCommand({ kind: "resume", model: config.model, sessionId, prompt: "fix" }).args.slice(0, 7), ["run", "--format", "json", "--model", config.model, "--session", sessionId]);
  assert.throws(() => openCodeCommand({ kind: "resume", model: config.model, sessionId: "bad id", prompt: "fix" }), /session ID/);
});

test("classifies explicit availability, failure, spawn, crash and success observations", () => {
  assert.equal(observeOpenCodeOutput([JSON.stringify({ type: "session.created", sessionID: sessionId }), JSON.stringify({ type: "error", status: 429, message: "rate limit" })], 1).outcome, "availability-limit");
  assert.equal(observeOpenCodeOutput([JSON.stringify({ type: "error", message: "usage limit reached" })], 1).availabilityReason, "USAGE_LIMIT");
  assert.equal(observeOpenCodeOutput([JSON.stringify({ type: "error", code: "quota_exceeded" })], 1).availabilityReason, "QUOTA_LIMIT");
  assert.equal(observeOpenCodeOutput([JSON.stringify({ type: "session.created", sessionID: sessionId })], 2).outcome, "failed");
  assert.equal(observeOpenCodeOutput([], null, "signal").outcome, "crash");
  assert.equal(observeOpenCodeOutput([], null, "spawn-error").outcome, "spawn-error");
  const success = observeOpenCodeOutput([JSON.stringify({ type: "session.created", sessionID: sessionId }), JSON.stringify({ type: "session.completed" })], 0);
  assert.equal(success.sessionId, sessionId);
  assert.equal(success.outcome, "success");
});

test("adapter starts, resumes, starts fresh recovery, records safe log evidence and retires", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "ao-opencode-log-"));
  const invocations: unknown[] = [];
  let killed = false;
  const adapter = new OpenCodeWorkerAdapter((invocation) => { invocations.push(invocation); return { ...fakeProcess([JSON.stringify({ type: "session.created", sessionID: sessionId })], 0), kill: () => { killed = true; } }; }, { ...config, logRoot, leasePath: join(logRoot, "lease"), preflight: async () => true });
  const started = await adapter.start("bounded task", config.workdir, "primary");
  const resumed = await adapter.resume(sessionId, "fix", config.workdir, "primary");
  const recovered = await adapter.startRecovery({ taskId: "AO-29", acceptance: "adapter", assumptions: [], invariants: [], branch: "agent/AO-29", head: "abc", machineValidation: "PASS", testFailures: [], reviewerFindings: [], attemptedFixSummary: "none" }, "recover", config.workdir);
  assert.equal(started.outcome, "success");
  assert.equal(resumed.fresh, false);
  assert.equal(recovered.role, "recovery");
  assert.equal(recovered.fresh, true);
  assert.equal(invocations.length, 3);
  assert.equal(await adapter.retire(77), false);
  assert.equal(killed, false);
  const log = await readFile(started.logPath, "utf8");
  assert.match(log, /session\.created/);
  assert.doesNotMatch(log, /bounded task|Durable recovery evidence/);
});

test("retirement sends SIGTERM only to an active process", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "ao-opencode-retire-"));
  let releaseExit: ((code: number | null) => void) | undefined;
  let releaseReason: ((reason: "exit" | "signal" | "spawn-error") => void) | undefined;
  let signal: NodeJS.Signals | undefined;
  const process: OpenCodeProcess = {
    pid: 88,
    stdout: (async function* () { yield JSON.stringify({ type: "session.created", sessionID: sessionId }); })(),
    stderr: (async function* () {})(),
    exitCode: new Promise((resolve) => { releaseExit = resolve; }),
    exitReason: new Promise((resolve) => { releaseReason = resolve; }),
    kill: (requested = "SIGTERM") => { signal = requested; releaseExit?.(null); releaseReason?.("signal"); },
  };
  const adapter = new OpenCodeWorkerAdapter(() => process, { ...config, logRoot, leasePath: join(logRoot, "lease"), preflight: async () => true });
  const running = adapter.start("bounded", config.workdir, "primary");
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(await adapter.retire(88), true);
  assert.equal(signal, "SIGTERM");
  assert.equal((await running).outcome, "crash");
});

test("read-only preflight requires exact OpenCode/Ollama/model/context facts", async () => {
  const result = await preflightLocalWorker(config, {
    pathExists: async () => true,
    runVersion: async () => ({ pass: true, detail: "OpenCode 1.18.23" }),
    readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.8:latest": { limit: { context: 262144 } } } } } }),
    listModels: async () => ["qwen3.8:latest"],
    modelContext: async () => 262144,
    serviceContext: async () => 262144,
  });
  assert.equal(result.pass, true);
  const unavailable = await preflightLocalWorker(config, { pathExists: async () => false, runVersion: async () => ({ pass: false, detail: "missing" }), readConfig: async () => "{}", listModels: async () => { throw new Error("offline"); }, modelContext: async () => null, serviceContext: async () => null });
  assert.equal(unavailable.pass, false);
  assert.ok(unavailable.checks.some((check) => check.name === "ollama-endpoint" && !check.pass));
  const downgraded = await preflightLocalWorker(config, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.8:latest": { limit: { context: 32768 } } } } } }), listModels: async () => ["qwen3.8:latest"], modelContext: async () => 32768, serviceContext: async () => 32768 });
  assert.equal(downgraded.pass, false);
  const insufficientModel = await preflightLocalWorker(config, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.8:latest": { limit: { context: 262144 } } } } } }), listModels: async () => ["qwen3.8:latest"], modelContext: async () => 32768, serviceContext: async () => 262144 });
  assert.equal(insufficientModel.pass, false);
  const forgedConfig = await preflightLocalWorker({ ...config, contextTokens: 32768 } as never, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.8:latest": { limit: { context: 262144 } } } } } }), listModels: async () => ["qwen3.8:latest"], modelContext: async () => 262144, serviceContext: async () => 262144 });
  assert.equal(forgedConfig.pass, false);
  const wrongModel = await preflightLocalWorker({ ...config, model: "ollama/qwen3.6:35b" } as never, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.6:35b": { limit: { context: 262144 } } } } } }), listModels: async () => ["qwen3.6:35b"], modelContext: async () => 262144, serviceContext: async () => 262144 });
  assert.equal(wrongModel.pass, false);
  const missingServiceContext = await preflightLocalWorker(config, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.8:latest": { limit: { context: 262144 } } } } } }), listModels: async () => ["qwen3.8:latest"], modelContext: async () => 262144, serviceContext: async () => null });
  assert.equal(missingServiceContext.pass, false);
});

test("preflight reads the namespaced Ollama model-info context key", async () => {
  const source = await import("../src/opencode/preflight.js");
  const response = await source.preflightLocalWorker(config, {
    pathExists: async () => true,
    runVersion: async () => ({ pass: true, detail: "ok" }),
    readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.8:latest": { limit: { context: 262144 } } } } } }),
    listModels: async () => ["qwen3.8:latest"],
    modelContext: async () => 262144,
    serviceContext: async () => 262144,
  });
  assert.equal(response.pass, true);
});

test("lease is atomic, records non-secret owner facts, and releases only its own record", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ao-lease-")), "shared");
  const first = new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 101 });
  const held = await first.acquire();
  assert.equal(held.evidence.status, "acquired");
  assert.deepEqual(JSON.parse(await readFile(join(path, "owner.json"), "utf8")), { ...held.handle?.record });
  const second = await new LocalInferenceLease({ path, owner: "kiji", model: "qwen3.6:35b", pid: 202 }).acquire();
  assert.equal(second.handle, undefined);
  assert.equal(second.evidence.status, "busy");
  assert.equal(second.evidence.owner, "agent-orchestrator");
  assert.equal(await held.handle?.release().then((result) => result.status), "released");
});

test("lease waits only within its bound and recovers a demonstrably dead owner of the same client", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ao-lease-")), "shared");
  await new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 303 }).acquire();
  const recovered = await new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 404, processAlive: (pid) => pid !== 303 }).acquire();
  assert.equal(recovered.evidence.recoveredStale, true);
  await recovered.handle?.release();
  const held = await new LocalInferenceLease({ path, owner: "kiji", model: "qwen3.6:35b", pid: 505 }).acquire();
  const timed = await new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 606, waitMs: 5, pollMs: 1 }).acquire();
  assert.equal(timed.evidence.status, "timeout");
  await held.handle?.release();
});

test("foreign owners and malformed records are never released or overwritten", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ao-lease-")), "shared");
  const foreign = new LocalInferenceLease({ path, owner: "kiji", model: "qwen3.6:35b", pid: 707 });
  const held = await foreign.acquire();
  const busy = await new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 808, processAlive: () => false }).acquire();
  assert.equal(busy.evidence.status, "busy");
  assert.equal(busy.evidence.owner, "kiji");
  await held.handle?.release();
  await mkdir(path);
  await writeFile(join(path, "owner.json"), "not-json\n", "utf8");
  const malformed = await new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 909 }).acquire();
  assert.equal(malformed.evidence.status, "malformed");
});

test("lease mutation gate rejects a claim for a different record nonce", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "ao-lease-")), "shared");
  const held = await new LocalInferenceLease({ path, owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 1002 }).acquire();
  await writeFile(join(path, "claim.json"), JSON.stringify({ owner: "agent-orchestrator", model: "ollama/qwen3.8:latest", pid: 1003, nonce: "different" }));
  assert.equal(await held.handle?.release().then((result) => result.status), "release-skipped");
  assert.equal(JSON.parse(await readFile(join(path, "owner.json"), "utf8")).nonce, held.handle?.record.nonce);
  await rm(join(path, "claim.json"));
  assert.equal(await held.handle?.release().then((result) => result.status), "released");
});

test("OpenCode acquires before process spawn and releases on success and spawn failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-adapter-"));
  const path = join(root, "shared");
  const fixture = (): OpenCodeProcess => ({ pid: 77, stdout: (async function* () { yield JSON.stringify({ type: "session.created", sessionID: "ses_lease" }); })(), stderr: (async function* () {})(), exitCode: Promise.resolve(0), exitReason: Promise.resolve("exit"), kill: () => undefined });
  let starts = 0;
  const adapter = new OpenCodeWorkerAdapter(() => { starts += 1; return fixture(); }, { executable: "/tmp/opencode", model: "ollama/qwen3.8:latest", contextTokens: 262144, leasePath: path, logRoot: root, preflight: async () => true });
  const success = await adapter.start("bounded", root, "primary");
  assert.equal(success.outcome, "success");
  assert.equal(success.lease?.status, "released");
  const failing = new OpenCodeWorkerAdapter(() => { starts += 1; throw new Error("spawn failed"); }, { executable: "/tmp/opencode", model: "ollama/qwen3.8:latest", contextTokens: 262144, leasePath: path, logRoot: root, preflight: async () => true });
  const failed = await failing.start("bounded", root, "primary");
  assert.equal(failed.outcome, "spawn-error");
  assert.equal(failed.lease?.status, "released");
  assert.equal(starts, 2);
  const foreign = await new LocalInferenceLease({ path, owner: "kiji", model: "qwen3.6:35b", pid: 1001 }).acquire();
  const blocked = await adapter.start("must-not-spawn", root, "primary");
  assert.equal(blocked.outcome, "lease-busy");
  assert.equal(blocked.lease?.owner, "kiji");
  assert.equal(starts, 2);
  await foreign.handle?.release();
});
