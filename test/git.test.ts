import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { GitAdapter, matchesGlob } from "../src/git/index.js";
const execFile = promisify(nodeExecFile);

test("scope glob matching is repository relative and supports star forms", () => {
  assert.equal(matchesGlob("src/config/schema.ts", "src/config/**"), true);
  assert.equal(matchesGlob("src/config.ts", "src/config/**"), false);
  assert.equal(matchesGlob("package.json", "package.json"), true);
  assert.equal(matchesGlob("src/config/schema.ts", "test/**"), false);
  assert.equal(matchesGlob("foo/bar.ts", "foo/**/bar.ts"), true);
  assert.equal(matchesGlob("foo/a/b/bar.ts", "foo/**/bar.ts"), true);
});

test("creates and snapshots a disposable worktree and rejects a wrong reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-git-"));
  const remote = await mkdtemp(join(tmpdir(), "ao-git-remote-"));
  const state = await mkdtemp(join(tmpdir(), "ao-git-state-"));
  const wrongState = await mkdtemp(join(tmpdir(), "ao-git-wrong-state-"));
  try {
    await execFile("git", ["init", "-b", "main"], { cwd: root });
    await execFile("git", ["config", "user.email", "ao@example.test"], { cwd: root });
    await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: root });
    await writeFile(join(root, "README.md"), "base\n");
    await execFile("git", ["add", "README.md"], { cwd: root });
    await execFile("git", ["commit", "-m", "base"], { cwd: root });
    await execFile("git", ["init", "--bare", remote]);
    await execFile("git", ["remote", "add", "origin", remote], { cwd: root });
    await execFile("git", ["push", "-u", "origin", "main"], { cwd: root });
    const adapter = new GitAdapter();
    const info = await adapter.prepareWorktree(root, "AO-06", state, "main");
    assert.equal(await adapter.branch(info.path), "agent/AO-06");
    assert.equal((await adapter.snapshot(info.path, "origin/main")).clean, true);
    await writeFile(join(info.path, "changed.txt"), "change\n");
    await execFile("git", ["add", "changed.txt"], { cwd: info.path });
    await execFile("git", ["commit", "-m", "change"], { cwd: info.path });
    assert.deepEqual(await adapter.changedFiles(info.path, "origin/main"), ["changed.txt"]);
    assert.equal(await adapter.isAncestor("origin/main", await adapter.head(info.path), root), true);
    assert.deepEqual(await adapter.prepareWorktree(root, "AO-06", state, "main"), info);
    const wrongPath = join(wrongState, "worktrees", "AO-06");
    await execFile("mkdir", ["-p", join(wrongState, "worktrees")]);
    await execFile("git", ["worktree", "add", "-b", "agent/wrong", wrongPath, "main"], { cwd: root });
    await assert.rejects(() => adapter.prepareWorktree(root, "AO-06", wrongState, "main"), /already assigned/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(remote, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
    await rm(wrongState, { recursive: true, force: true });
  }
});
