import assert from "node:assert/strict";
import test from "node:test";
import { compactReviewPacket, splitCommand } from "../src/validation/index.js";
import { GitAdapter, GitSnapshot } from "../src/git/index.js";
import { MachineValidator } from "../src/validation/index.js";
import { ManifestTask } from "../src/config/index.js";

test("splits configured commands without shell evaluation", () => {
  assert.deepEqual(splitCommand("npm test -- 'manifest suite'"), ["npm", "test", "--", "manifest suite"]);
});

class FakeGit extends GitAdapter {
  constructor(private readonly branchName = "agent/AO-08", private readonly ancestor = true) { super(); }
  override async snapshot(_worktree: string, _baseRef: string): Promise<GitSnapshot> { return { branch: this.branchName, head: "abc", clean: true, changedFiles: ["src/validation/validator.ts"] }; }
  override async scopeCheck(): Promise<{ pass: boolean; unexpected: readonly string[] }> { return { pass: true, unexpected: [] }; }
  override async remoteContains(): Promise<boolean> { return true; }
  override async isAncestor(): Promise<boolean> { return this.ancestor; }
}

const validationTask: ManifestTask = { id: "AO-08", title: "validation", dependsOn: [], parallel: "SAFE", humanGate: false, allowedPaths: ["src/validation/**"], test: "true" };

test("machine validator records branch/worktree/base evidence and fail-closes", async () => {
  const pass = await new MachineValidator(new FakeGit()).validate(validationTask, { worktree: "/tmp", repo: "/tmp/repo", baseRef: "origin/main", remoteBranch: "agent/AO-08", dependenciesPass: true, expectedBranch: "agent/AO-08", expectedWorktree: "/tmp" });
  assert.equal(new MachineValidator(new FakeGit()).isPass(pass), true);
  const wrongBranch = await new MachineValidator(new FakeGit("main")).validate(validationTask, { worktree: "/tmp", repo: "/tmp/repo", baseRef: "origin/main", remoteBranch: "agent/AO-08", dependenciesPass: true, expectedBranch: "agent/AO-08", expectedWorktree: "/tmp" });
  assert.equal(new MachineValidator(new FakeGit()).isPass(wrongBranch), false);
  const wrongBase = await new MachineValidator(new FakeGit("agent/AO-08", false)).validate(validationTask, { worktree: "/tmp", repo: "/tmp/repo", baseRef: "origin/main", remoteBranch: "agent/AO-08", dependenciesPass: true, expectedBranch: "agent/AO-08", expectedWorktree: "/tmp" });
  assert.equal(new MachineValidator(new FakeGit()).isPass(wrongBase), false);
});

test("review packet is compact and exposes machine evidence", () => {
  const text = compactReviewPacket({ taskId: "AO-08", canonicalTask: "AO-08", worktree: "/tmp/w", baseRef: "origin/main", branch: "agent/AO-08", head: "abc", pushed: true, clean: true, changedFiles: ["src/validation/validator.ts"], unexpectedFiles: [], scope: "PASS", test: { command: "npm test -- validation", exitCode: 0, pass: true }, dependencies: "PASS", branchCheck: "PASS", worktreeCheck: "PASS", baseAncestor: "PASS", previousRework: "fix test", acceptance: "validator" });
  assert.match(text, /Push: PASS/);
  assert.match(text, /Scope check: PASS/);
  assert.doesNotMatch(text, /token|secret/i);
  assert.match(text, /Previous rework: fix test/);
});
