import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCliOperations } from "../src/cli/index.js";

const execFile = promisify(nodeExecFile);
const root = process.cwd();
const entrypoint = join(root, "bin", "agent-orchestrator.mjs");

test("repository-owned entrypoint has no import side effect and exposes command shape", async () => {
  const imported = await execFile(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(entrypoint)})`], { cwd: root });
  assert.equal(imported.stdout, "");
  const help = await execFile(process.execPath, [entrypoint, "--help"], { cwd: root });
  assert.match(help.stdout, /bootstrap.*run-once.*daemon.*reconcile.*status/);
});

test("entrypoint fails closed without an absolute config path and status loads only the delta", async () => {
  await assert.rejects(execFile(process.execPath, [entrypoint, "status"], { cwd: root, env: { ...process.env, AO_CONFIG_PATH: undefined } }), /AO_CONFIG_PATH/);
  const stateRoot = await mkdtemp(join(tmpdir(), "ao-entry-state-"));
  const configPath = join(stateRoot, "config.yaml");
  await writeFile(configPath, `version: 1\npilot:\n  targetRepo: /Users/eita/projects/slot\n  baseBranch: main\n  manifestPath: tasks/agent-orchestrator-preinstall-delta.yaml\n  boardPath: docs/task-boards/2026-09-02-agent-orchestrator-preinstall-delta.md\nstateRoot: ${stateRoot}\npollIntervalMs: 30000\nmaxLunaWorkers: 2\nmaxResumeAttempts: 2\nretryIntervalMs: 300000\n`);
  const status = await execFile(process.execPath, [entrypoint, "status"], { cwd: root, env: { ...process.env, AO_CONFIG_PATH: configPath } });
  assert.match(status.stdout, /agent-orchestrator-preinstall-delta/);
  assert.match(status.stdout, /"version":2/);
});

test("concrete run-once composition uses a fake Issue boundary and never starts Codex", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "ao-entry-run-"));
  const configPath = join(stateRoot, "config.yaml");
  await writeFile(configPath, `version: 1\npilot:\n  targetRepo: /Users/eita/projects/slot\n  baseBranch: main\n  manifestPath: tasks/agent-orchestrator-preinstall-delta.yaml\n  boardPath: docs/task-boards/2026-09-02-agent-orchestrator-preinstall-delta.md\nstateRoot: ${stateRoot}\npollIntervalMs: 30000\nmaxLunaWorkers: 2\nmaxResumeAttempts: 2\nretryIntervalMs: 300000\n`);
  let calls = 0;
  const operations = createCliOperations({ cwd: root, env: { AO_CONFIG_PATH: configPath }, gh: { run: async () => { calls += 1; return { stdout: "[]", stderr: "", code: 0 }; } } });
  await operations.runOnce();
  assert.equal(calls, 1);
});

test("AO-43+ config selects the disposable runtime composition explicitly", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "ao-runtime-config-state-"));
  const configPath = join(stateRoot, "config.yaml");
  await writeFile(configPath, `version: 1\npilot:\n  targetRepo: /Users/eita/projects/slot\n  baseBranch: main\n  manifestPath: tasks/agent-orchestrator-runtime-composition.yaml\n  boardPath: docs/task-boards/2026-09-06-runtime-composition.md\nstateRoot: ${stateRoot}\npollIntervalMs: 30000\nmaxLunaWorkers: 2\nmaxResumeAttempts: 2\nretryIntervalMs: 300000\nruntime:\n  target: disposable\n  disposable:\n    targetRepo: /tmp/agent-orchestrator-disposable-target\n    baseBranch: main\n    allowedRoots: [/tmp]\n  production:\n    enabled: false\n    targetRepo: /Users/eita/projects/slot\n    baseBranch: main\n`);
  let invoked = 0;
  const operations = createCliOperations({ cwd: root, env: { AO_CONFIG_PATH: configPath }, runtimeFactory: () => { invoked += 1; return { poll: async () => ({ kind: "idle" }) } as never; } });
  await operations.runOnce();
  assert.equal(invoked, 1);
});
