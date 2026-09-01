import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";

const execFile = promisify(nodeExecFile);
const root = process.cwd();
const packaging = join(root, "packaging", "launchd");
const manager = join(packaging, "manage.sh");
const label = "com.az-claude.agent-orchestrator";

test("LaunchAgent template is valid and contains only supported controls", async () => {
  const template = await readFile(join(packaging, `${label}.plist.template`), "utf8");
  assert.match(template, /<key>RunAtLoad<\/key>/);
  assert.match(template, /<key>KeepAlive<\/key>/);
  assert.match(template, /__NODE__/);
  assert.match(template, /__WORKDIR__/);
  const result = await execFile("plutil", ["-lint", join(packaging, `${label}.plist.template`)], { cwd: root });
  assert.match(result.stdout, /OK/);
});

test("verify is read-only and install lifecycle is explicit and disposable", async () => {
  const home = await mkdtemp(join(tmpdir(), "ao-launchd-home-"));
  const bin = await mkdtemp(join(tmpdir(), "ao-launchd-bin-"));
  const calls = join(home, "launchctl.calls");
  const fakeLaunchctl = join(bin, "launchctl");
  await writeFile(fakeLaunchctl, `#!/bin/sh\nprintf '%s\n' "$*" >> '${calls}'\ncase "$1" in print) exit 0;; *) exit 0;; esac\n`, { mode: 0o700 });
  await chmod(fakeLaunchctl, 0o700);
  const cli = join(home, "cli.mjs");
  const workdir = join(home, "worktree");
  await writeFile(cli, "export {};\n");
  await mkdir(workdir);
  const env = { ...process.env, HOME: home, AO_LAUNCHD_HOME: home, AO_LAUNCHD_LAUNCHCTL: fakeLaunchctl, AO_LAUNCHD_NODE: process.execPath, AO_LAUNCHD_CLI: cli, AO_LAUNCHD_WORKDIR: workdir, AO_LAUNCHD_LOG_DIR: join(home, "logs") };
  await execFile(manager, ["verify"], { cwd: root, env });
  const target = join(home, "Library", "LaunchAgents", `${label}.plist`);
  await assert.rejects(readFile(target, "utf8"));
  await execFile(manager, ["install"], { cwd: root, env });
  const rendered = await readFile(target, "utf8");
  assert.match(rendered, new RegExp(`<string>${escapeRegExp(process.execPath)}<\\/string>`));
  assert.doesNotMatch(rendered, /__[A-Z_]+__/);
  await execFile(manager, ["status"], { cwd: root, env });
  await execFile(manager, ["uninstall"], { cwd: root, env });
  await assert.rejects(readFile(target, "utf8"));
  const history = await readFile(calls, "utf8");
  assert.match(history, /bootout/);
  assert.match(history, /bootstrap/);
  assert.match(history, /print/);
});

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
