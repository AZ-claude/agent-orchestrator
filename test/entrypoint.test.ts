import assert from "node:assert/strict";
import test from "node:test";
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCliOperations } from "../src/cli/index.js";
import { TargetAwareGhClient } from "../src/github/index.js";

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
  await writeFile(configPath, `version: 1\npilot:\n  targetRepo: /Users/eita/projects/slot\n  baseBranch: main\n  manifestPath: tasks/agent-orchestrator-runtime-composition.yaml\n  boardPath: docs/task-boards/2026-09-06-runtime-composition.md\nstateRoot: ${stateRoot}\npollIntervalMs: 30000\nmaxLunaWorkers: 2\nmaxResumeAttempts: 2\nretryIntervalMs: 300000\nruntime:\n  target: disposable\n  disposable:\n    targetRepo: /tmp/agent-orchestrator-disposable-target\n    baseBranch: main\n    githubRepo: example/agent-orchestrator-disposable\n    allowedRoots: [/tmp]\n  production:\n    enabled: false\n    targetRepo: /Users/eita/.local/share/agent-orchestrator/targets/slot\n    baseBranch: master\n    githubRepo: AZ-claude/slot\n`);
  const gh = new TargetAwareGhClient(async (command, args) => {
    if (command === "git") return { stdout: "https://github.com/example/agent-orchestrator-disposable.git\n", stderr: "", code: 0 };
    if (args[0] === "repo" && args[1] === "view") return { stdout: JSON.stringify({ nameWithOwner: "example/agent-orchestrator-disposable" }), stderr: "", code: 0 };
    return { stdout: "[]", stderr: "", code: 0 };
  }, "example/agent-orchestrator-disposable");
  const { main } = await import(entrypoint);
  await main(["run-once"], { AO_CONFIG_PATH: configPath }, root, { gh });
});

test("AO-51 executes the real bin entrypoint through concrete composition without runtimeFactory injection", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "ao-concrete-entrypoint-"));
  const target = "/tmp/agent-orchestrator-disposable-target";
  let createdTarget = false;
  try { await access(target); } catch { createdTarget = true; }
  const stateRoot = join(fixture, "state");
  try {
    if (createdTarget) {
      await mkdir(target);
      await execFile("git", ["init", "-b", "main"], { cwd: target });
      await execFile("git", ["config", "user.email", "ao@example.test"], { cwd: target });
      await execFile("git", ["config", "user.name", "AO Test"], { cwd: target });
      await writeFile(join(target, "README.md"), "fixture\n");
      await execFile("git", ["add", "."], { cwd: target });
      await execFile("git", ["commit", "-m", "initial"], { cwd: target });
      await execFile("git", ["remote", "add", "origin", "https://github.com/example/agent-orchestrator-disposable.git"], { cwd: target });
    }
    const remote = (await execFile("git", ["remote", "get-url", "origin"], { cwd: target })).stdout.trim();
    const githubRepo = remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    assert.ok(githubRepo, "fixture target must have a GitHub owner/repository origin");
    const ghPath = join(fixture, "gh");
    await writeFile(ghPath, `#!/bin/sh\nif [ \"$1\" = repo ]; then echo '{\"nameWithOwner\":\"${githubRepo}\"}'; else echo '[]'; fi\n`);
    await chmod(ghPath, 0o755);
    const configPath = join(fixture, "config.yaml");
    await writeFile(configPath, `version: 1\npilot:\n  targetRepo: /Users/eita/projects/slot\n  baseBranch: main\n  manifestPath: tasks/agent-orchestrator-runtime-composition.yaml\n  boardPath: docs/task-boards/2026-09-06-runtime-composition.md\nstateRoot: ${stateRoot}\npollIntervalMs: 30000\nmaxLunaWorkers: 1\nmaxResumeAttempts: 2\nretryIntervalMs: 300000\nworker:\n  mode: cloud\n  primary: cloud\n  recovery: cloud\nruntime:\n  target: disposable\n  disposable:\n    targetRepo: ${target}\n    baseBranch: main\n    githubRepo: ${githubRepo}\n    allowedRoots: [/tmp]\n  production:\n    enabled: false\n    targetRepo: /Users/eita/.local/share/agent-orchestrator/targets/slot\n    baseBranch: master\n    githubRepo: AZ-claude/slot\n`);
    const result = await execFile(process.execPath, [entrypoint, "run-once"], { cwd: root, env: { ...process.env, AO_CONFIG_PATH: configPath, PATH: `${fixture}:${process.env.PATH ?? ""}` } });
    assert.match(result.stdout, /"kind":"idle"/);
  } finally {
    if (createdTarget) await rm(target, { recursive: true, force: true });
  }
});
