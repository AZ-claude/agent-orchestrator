import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { GitAdapter, matchesGlob } from "../src/git/index.js";
import { PRODUCTION_TARGET_REPO } from "../src/config/index.js";
const execFile = promisify(nodeExecFile);

test("scope glob matching is repository relative and supports star forms", () => {
  assert.equal(matchesGlob("src/config/schema.ts", "src/config/**"), true);
  assert.equal(matchesGlob("src/config.ts", "src/config/**"), false);
  assert.equal(matchesGlob("package.json", "package.json"), true);
  assert.equal(matchesGlob("src/config/schema.ts", "test/**"), false);
  assert.equal(matchesGlob("foo/bar.ts", "foo/**/bar.ts"), true);
  assert.equal(matchesGlob("foo/a/b/bar.ts", "foo/**/bar.ts"), true);
});

test("merge gate evaluation requires every deterministic fact and reviewed HEAD equality", () => {
  const adapter = new GitAdapter();
  const facts = { requiredTestsPass: true, machineValidationPass: true, scopePass: true, unexpectedDiffPass: true, cleanWorktree: true, pushedBranch: true, dependencyBasePass: true, reviewedHead: "abc", currentHead: "abc", unresolvedHumanGate: false, activeMergeBarrier: false };
  assert.equal(adapter.evaluateMergeGates(facts).pass, true);
  for (const key of ["requiredTestsPass", "machineValidationPass", "scopePass", "unexpectedDiffPass", "cleanWorktree", "pushedBranch", "dependencyBasePass"] as const) assert.equal(adapter.evaluateMergeGates({ ...facts, [key]: false }).pass, false);
  assert.deepEqual(adapter.evaluateMergeGates({ ...facts, currentHead: "changed" }).failedGates, ["reviewed-head-equality"]);
  assert.deepEqual(adapter.evaluateMergeGates({ ...facts, activeMergeBarrier: true }).failedGates, ["no-merge-barrier"]);
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

test("performs the all-pass merge path only after rechecking the reviewed source HEAD", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-merge-"));
  const remote = await mkdtemp(join(tmpdir(), "ao-merge-remote-"));
  try {
    await execFile("git", ["init", "-b", "main"], { cwd: root });
    await execFile("git", ["config", "user.email", "ao@example.test"], { cwd: root });
    await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: root });
    await writeFile(join(root, "README.md"), "base\n"); await execFile("git", ["add", "README.md"], { cwd: root }); await execFile("git", ["commit", "-m", "base"], { cwd: root });
    await execFile("git", ["init", "--bare", remote]); await execFile("git", ["remote", "add", "origin", remote], { cwd: root }); await execFile("git", ["push", "-u", "origin", "main"], { cwd: root });
    await execFile("git", ["checkout", "-b", "agent/AO-18"], { cwd: root }); await writeFile(join(root, "merge.txt"), "merged\n"); await execFile("git", ["add", "merge.txt"], { cwd: root }); await execFile("git", ["commit", "-m", "change"], { cwd: root });
    const sourceHead = (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); await execFile("git", ["push", "-u", "origin", "agent/AO-18"], { cwd: root });
    const facts = { requiredTestsPass: true, machineValidationPass: true, scopePass: true, unexpectedDiffPass: true, cleanWorktree: true, pushedBranch: true, dependencyBasePass: true, reviewedHead: sourceHead, currentHead: sourceHead, unresolvedHumanGate: false, activeMergeBarrier: false };
    const result = await new GitAdapter().mergeReviewedBranch({ repo: root, baseBranch: "main", sourceBranch: "agent/AO-18", sourceWorktree: root, facts });
    assert.equal(result.pass, true); assert.equal((await execFile("git", ["branch", "--show-current"], { cwd: root })).stdout.trim(), "main");
  } finally { await rm(root, { recursive: true, force: true }); await rm(remote, { recursive: true, force: true }); }
});

test("fails the merge gate when a successful push command does not update the remote base", async () => {
  const root = await mkdtemp(join(tmpdir(), "ao-merge-verify-"));
  const remote = await mkdtemp(join(tmpdir(), "ao-merge-verify-remote-"));
  try {
    await execFile("git", ["init", "-b", "main"], { cwd: root });
    await execFile("git", ["config", "user.email", "ao@example.test"], { cwd: root });
    await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: root });
    await writeFile(join(root, "README.md"), "base\n"); await execFile("git", ["add", "README.md"], { cwd: root }); await execFile("git", ["commit", "-m", "base"], { cwd: root });
    await execFile("git", ["init", "--bare", remote]); await execFile("git", ["remote", "add", "origin", remote], { cwd: root }); await execFile("git", ["push", "-u", "origin", "main"], { cwd: root });
    await execFile("git", ["checkout", "-b", "agent/AO-VERIFY"], { cwd: root }); await writeFile(join(root, "merge.txt"), "merged\n"); await execFile("git", ["add", "merge.txt"], { cwd: root }); await execFile("git", ["commit", "-m", "change"], { cwd: root });
    const sourceHead = (await execFile("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); await execFile("git", ["push", "-u", "origin", "agent/AO-VERIFY"], { cwd: root });
    const adapter = new GitAdapter(async (command, args, options) => {
      if (command === "git" && args[0] === "push" && args[2] === "main") return { stdout: "", stderr: "", code: 0 };
      const result = await execFile(command, [...args], { cwd: options?.cwd });
      return { stdout: result.stdout, stderr: result.stderr, code: 0 };
    });
    const result = await adapter.mergeReviewedBranch({ repo: root, baseBranch: "main", sourceBranch: "agent/AO-VERIFY", sourceWorktree: root, facts: { requiredTestsPass: true, machineValidationPass: true, scopePass: true, unexpectedDiffPass: true, cleanWorktree: true, pushedBranch: true, dependencyBasePass: true, reviewedHead: sourceHead, currentHead: sourceHead, unresolvedHumanGate: false, activeMergeBarrier: false } });
    assert.equal(result.pass, false);
    assert.deepEqual(result.failedGates, ["remote-base-head-verification"]);
    assert.equal((await execFile("git", ["ls-remote", "origin", "refs/heads/main"], { cwd: root })).stdout.includes(sourceHead), false);
  } finally { await rm(root, { recursive: true, force: true }); await rm(remote, { recursive: true, force: true }); }
});

test("AO-56 production inspection permits only a clean, synced owned slot/master clone", async () => {
  const calls: string[] = [];
  const head = "a".repeat(40);
  const runner = async (command: string, args: readonly string[], options?: { readonly cwd?: string }) => {
    calls.push(`${options?.cwd ?? ""}: ${command} ${args.join(" ")}`);
    if (options?.cwd === "/Users/eita/projects/slot") throw new Error("legacy development checkout must never be touched");
    const key = args.join(" ");
    if (key === "rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "", code: 0 };
    if (key === "remote get-url origin") return { stdout: "https://github.com/AZ-claude/slot.git\n", stderr: "", code: 0 };
    if (key === "branch --show-current") return { stdout: "master\n", stderr: "", code: 0 };
    if (key === "status --porcelain") return { stdout: "", stderr: "", code: 0 };
    if (key === "worktree list --porcelain") return { stdout: `worktree ${PRODUCTION_TARGET_REPO}\nHEAD ${head}\nbranch refs/heads/master\n\n`, stderr: "", code: 0 };
    if (key === "rev-parse refs/remotes/origin/master" || key === "rev-parse HEAD") return { stdout: `${head}\n`, stderr: "", code: 0 };
    if (key === "ls-remote origin refs/heads/master") return { stdout: `${head}\trefs/heads/master\n`, stderr: "", code: 0 };
    return { stdout: "", stderr: `unexpected ${key}`, code: 1 };
  };
  const target = { enabled: true as const, targetRepo: PRODUCTION_TARGET_REPO, baseBranch: "master", githubRepo: "AZ-claude/slot" as const };
  const facts = await new GitAdapter(runner).inspectProductionTarget(target, "/Users/eita/.local/state/agent-orchestrator");
  assert.equal(facts.remoteMaster, head);
  assert.equal(calls.some((call) => call.includes("/Users/eita/projects/slot")), false);
});

test("AO-56 production inspection fails closed for dirty, mismatched origin, and stale tracking facts", async () => {
  const head = "b".repeat(40);
  const target = { enabled: true as const, targetRepo: PRODUCTION_TARGET_REPO, baseBranch: "master", githubRepo: "AZ-claude/slot" as const };
  const fixture = (overrides: Partial<Record<string, string>>) => new GitAdapter(async (_command, args) => {
    const key = args.join(" ");
    const values: Record<string, string> = {
      "rev-parse --is-inside-work-tree": "true\n",
      "remote get-url origin": "https://github.com/AZ-claude/slot.git\n",
      "branch --show-current": "master\n",
      "status --porcelain": "",
      "worktree list --porcelain": `worktree ${PRODUCTION_TARGET_REPO}\nHEAD ${head}\nbranch refs/heads/master\n\n`,
      "rev-parse refs/remotes/origin/master": `${head}\n`,
      "rev-parse HEAD": `${head}\n`,
      "ls-remote origin refs/heads/master": `${head}\trefs/heads/master\n`,
      ...overrides,
    };
    const stdout = values[key];
    return stdout === undefined ? { stdout: "", stderr: "unexpected", code: 1 } : { stdout, stderr: "", code: 0 };
  });
  await assert.rejects(() => fixture({ "status --porcelain": " M changed\n" }).inspectProductionTarget(target, "/tmp/state"), /dirty/);
  await assert.rejects(() => fixture({ "remote get-url origin": "https://github.com/AZ-claude/kiji.git\n" }).inspectProductionTarget(target, "/tmp/state"), /origin/);
  await assert.rejects(() => fixture({ "ls-remote origin refs/heads/master": `${"c".repeat(40)}\trefs/heads/master\n` }).inspectProductionTarget(target, "/tmp/state"), /does not match remote master/);
});

test("AO-56 dispatch synchronization fetches before accepting origin/master and rejects fetch failure", async () => {
  const oldHead = "d".repeat(40);
  const newHead = "e".repeat(40);
  let fetched = false;
  const target = { enabled: true as const, targetRepo: PRODUCTION_TARGET_REPO, baseBranch: "master", githubRepo: "AZ-claude/slot" as const };
  const runner = async (_command: string, args: readonly string[]) => {
    const key = args.join(" ");
    if (key === "fetch origin master") { fetched = true; return { stdout: "", stderr: "", code: 0 }; }
    const head = fetched ? newHead : oldHead;
    const values: Record<string, string> = {
      "rev-parse --is-inside-work-tree": "true\n",
      "remote get-url origin": "https://github.com/AZ-claude/slot.git\n",
      "branch --show-current": "master\n",
      "status --porcelain": "",
      "worktree list --porcelain": `worktree ${PRODUCTION_TARGET_REPO}\nHEAD ${head}\nbranch refs/heads/master\n\n`,
      "rev-parse refs/remotes/origin/master": `${head}\n`,
      "rev-parse HEAD": `${head}\n`,
      "ls-remote origin refs/heads/master": `${head}\trefs/heads/master\n`,
    };
    const stdout = values[key];
    return stdout === undefined ? { stdout: "", stderr: "unexpected", code: 1 } : { stdout, stderr: "", code: 0 };
  };
  const facts = await new GitAdapter(runner).synchronizeProductionTarget(target, "/tmp/state");
  assert.equal(fetched, true);
  assert.equal(facts.head, newHead);
  await assert.rejects(() => new GitAdapter(async (_command, args) => args[0] === "fetch" ? { stdout: "", stderr: "network unavailable", code: 1 } : runner(_command, args)).synchronizeProductionTarget(target, "/tmp/state"), /fetch/);
});
