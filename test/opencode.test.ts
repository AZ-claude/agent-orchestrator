import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCodeProcess, openCodeCommand, observeOpenCodeOutput } from "../src/opencode/lifecycle.js";
import { OpenCodeWorkerAdapter } from "../src/opencode/runner.js";
import { preflightLocalWorker } from "../src/opencode/preflight.js";

const sessionId = "ses_fixture_01";
const config = { executable: "/tmp/opencode", model: "ollama/qwen3.6:35b", contextTokens: 262144, workdir: "/tmp/worktree", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/opencode.jsonc" } as const;

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
  const adapter = new OpenCodeWorkerAdapter((invocation) => { invocations.push(invocation); return { ...fakeProcess([JSON.stringify({ type: "session.created", sessionID: sessionId })], 0), kill: () => { killed = true; } }; }, { ...config, logRoot });
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
  const adapter = new OpenCodeWorkerAdapter(() => process, { ...config, logRoot });
  const running = adapter.start("bounded", config.workdir, "primary");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(await adapter.retire(88), true);
  assert.equal(signal, "SIGTERM");
  assert.equal((await running).outcome, "crash");
});

test("read-only preflight requires exact OpenCode/Ollama/model/context facts", async () => {
  const result = await preflightLocalWorker(config, {
    pathExists: async () => true,
    runVersion: async () => ({ pass: true, detail: "OpenCode 1.18.23" }),
    readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.6:35b": { limit: { context: 262144 } } } } } }),
    listModels: async () => ["qwen3.6:35b"],
    modelContext: async () => 262144,
  });
  assert.equal(result.pass, true);
  const unavailable = await preflightLocalWorker(config, { pathExists: async () => false, runVersion: async () => ({ pass: false, detail: "missing" }), readConfig: async () => "{}", listModels: async () => { throw new Error("offline"); }, modelContext: async () => null });
  assert.equal(unavailable.pass, false);
  assert.ok(unavailable.checks.some((check) => check.name === "ollama-endpoint" && !check.pass));
  const downgraded = await preflightLocalWorker(config, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.6:35b": { limit: { context: 32768 } } } } } }), listModels: async () => ["qwen3.6:35b"], modelContext: async () => 32768 });
  assert.equal(downgraded.pass, false);
  const insufficientModel = await preflightLocalWorker(config, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.6:35b": { limit: { context: 262144 } } } } } }), listModels: async () => ["qwen3.6:35b"], modelContext: async () => 32768 });
  assert.equal(insufficientModel.pass, false);
  const forgedConfig = await preflightLocalWorker({ ...config, contextTokens: 32768 } as never, { pathExists: async () => true, runVersion: async () => ({ pass: true, detail: "ok" }), readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.6:35b": { limit: { context: 262144 } } } } } }), listModels: async () => ["qwen3.6:35b"], modelContext: async () => 262144 });
  assert.equal(forgedConfig.pass, false);
});

test("preflight reads the namespaced Ollama model-info context key", async () => {
  const source = await import("../src/opencode/preflight.js");
  const response = await source.preflightLocalWorker(config, {
    pathExists: async () => true,
    runVersion: async () => ({ pass: true, detail: "ok" }),
    readConfig: async () => JSON.stringify({ provider: { ollama: { models: { "qwen3.6:35b": { limit: { context: 262144 } } } } } }),
    listModels: async () => ["qwen3.6:35b"],
    modelContext: async () => 262144,
  });
  assert.equal(response.pass, true);
});
