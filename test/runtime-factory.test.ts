import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse as parseYaml } from "yaml";
import { createConcreteRuntime } from "../src/cli/index.js";
import { defaultPilotConfig, parseManifestForTarget, RuntimeTargetConfig } from "../src/config/index.js";
import { TargetAwareGhClient } from "../src/github/index.js";
import { RuntimeComposition } from "../src/runtime/index.js";

test("AO-50 factory assembles the concrete runtime from cloud configuration", async () => {
  const targetRepo = "/tmp/agent-orchestrator-disposable-target";
  const manifest = parseManifestForTarget(parseYaml(await readFile("tasks/agent-orchestrator-runtime-composition.yaml", "utf8")), targetRepo);
  const target: RuntimeTargetConfig = {
    target: "disposable",
    disposable: { targetRepo, baseBranch: "main", githubRepo: "example/disposable", allowedRoots: ["/tmp"] },
    production: { enabled: false, targetRepo: "/Users/eita/.local/share/agent-orchestrator/targets/slot", baseBranch: "master", githubRepo: "AZ-claude/slot" },
  };
  const base = defaultPilotConfig();
  const runtime = { root: process.cwd(), config: { ...base, runtime: target, worker: { mode: "cloud" as const, primary: "cloud" as const, recovery: "cloud" as const } }, manifest, checkpoints: [] };
  const gh = new TargetAwareGhClient(async () => ({ stdout: "", stderr: "", code: 0 }), "example/disposable");
  assert.ok(createConcreteRuntime(runtime, gh) instanceof RuntimeComposition);
});

test("AO-50 factory rejects a local worker outside the fixed Qwen contract", async () => {
  const targetRepo = "/tmp/agent-orchestrator-disposable-target";
  const manifest = parseManifestForTarget(parseYaml(await readFile("tasks/agent-orchestrator-runtime-composition.yaml", "utf8")), targetRepo);
  const target: RuntimeTargetConfig = {
    target: "disposable",
    disposable: { targetRepo, baseBranch: "main", githubRepo: "example/disposable", allowedRoots: ["/tmp"] },
    production: { enabled: false, targetRepo: "/Users/eita/.local/share/agent-orchestrator/targets/slot", baseBranch: "master", githubRepo: "AZ-claude/slot" },
  };
  const base = defaultPilotConfig();
  const runtime = { root: process.cwd(), config: { ...base, runtime: target, worker: { mode: "local", primary: "local", recovery: "local", local: { executable: "opencode", model: "ollama/other", contextTokens: 128000, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/opencode.jsonc", leasePath: "/tmp/ao-lease" } } }, manifest, checkpoints: [] } as unknown as Parameters<typeof createConcreteRuntime>[0];
  const gh = new TargetAwareGhClient(async () => ({ stdout: "", stderr: "", code: 0 }), "example/disposable");
  assert.throws(() => createConcreteRuntime(runtime, gh), /AO local worker model/);
});

test("AO-55 factory composes the exact enabled slot/master production target", async () => {
  const targetRepo = "/Users/eita/.local/share/agent-orchestrator/targets/slot";
  const manifest = parseManifestForTarget(parseYaml(await readFile("tasks/agent-orchestrator-production.yaml", "utf8")), targetRepo);
  const target: RuntimeTargetConfig = {
    target: "production",
    disposable: { targetRepo: "/tmp/agent-orchestrator-disposable-target", baseBranch: "main", githubRepo: "example/disposable", allowedRoots: ["/tmp"] },
    production: { enabled: true, targetRepo, baseBranch: "master", githubRepo: "AZ-claude/slot" },
  };
  const base = defaultPilotConfig();
  const runtime = { root: process.cwd(), config: { ...base, runtime: target, worker: { mode: "cloud" as const, primary: "cloud" as const, recovery: "cloud" as const } }, manifest, checkpoints: [] };
  const gh = new TargetAwareGhClient(async () => ({ stdout: "", stderr: "", code: 0 }), "AZ-claude/slot");
  assert.ok(createConcreteRuntime(runtime, gh) instanceof RuntimeComposition);
});
