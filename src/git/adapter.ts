import { execFile as nodeExecFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { join, relative, resolve } from "node:path";
import { PRODUCTION_BASE_BRANCH, PRODUCTION_GITHUB_REPO, PRODUCTION_TARGET_REPO, PRODUCTION_TARGET_ROOT, ProductionTargetConfig } from "../config/index.js";

const execFile = promisify(nodeExecFile);

export interface CommandResult { readonly stdout: string; readonly stderr: string; readonly code: number; }
export type CommandRunner = (command: string, args: readonly string[], options?: { readonly cwd?: string }) => Promise<CommandResult>;

export interface WorktreeInfo { readonly taskId: string; readonly branch: string; readonly path: string; }
export interface GitSnapshot {
  readonly branch: string;
  readonly head: string;
  readonly clean: boolean;
  readonly changedFiles: readonly string[];
}

export interface WorkerGitObservation {
  readonly branch: string;
  readonly currentHead: string;
  readonly baseHead: string;
  readonly baseAncestor: boolean;
  readonly remoteHead: string | null;
  /** The assigned branch is structurally trustworthy for recovery. */
  readonly valid: boolean;
  /** The remote branch points at the exact worktree HEAD. */
  readonly pushed: boolean;
}

export interface ProductionTargetFacts {
  readonly targetRepo: string;
  readonly origin: string;
  readonly branch: string;
  readonly head: string;
  readonly originMaster: string;
  readonly remoteMaster: string;
}

export interface MergeGateFacts {
  readonly requiredTestsPass: boolean;
  readonly machineValidationPass: boolean;
  readonly scopePass: boolean;
  readonly unexpectedDiffPass: boolean;
  readonly cleanWorktree: boolean;
  readonly pushedBranch: boolean;
  readonly dependencyBasePass: boolean;
  readonly reviewedHead: string;
  readonly currentHead: string;
  readonly unresolvedHumanGate: boolean;
  readonly activeMergeBarrier: boolean;
}

export interface MergeGateResult {
  readonly pass: boolean;
  readonly failedGates: readonly string[];
  readonly reviewedHead: string;
  readonly currentHead: string;
}

export interface MergeRequest {
  readonly repo: string;
  readonly baseBranch: string;
  readonly sourceBranch: string;
  readonly facts: MergeGateFacts;
  readonly sourceWorktree?: string;
}

export class GitCommandError extends Error {
  constructor(readonly command: string, readonly args: readonly string[], readonly result: CommandResult) {
    super(`git ${command} failed (${result.code}): ${result.stderr || result.stdout}`);
    this.name = "GitCommandError";
  }
}

export const defaultCommandRunner: CommandRunner = async (command, args, options) => {
  try {
    const result = await execFile(command, [...args], { cwd: options?.cwd, maxBuffer: 2 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: typeof failure.code === "number" ? failure.code : 1 };
  }
};

export class GitAdapter {
  constructor(private readonly run: CommandRunner = defaultCommandRunner) {}

  async prepareWorktree(repo: string, taskId: string, stateRoot: string, baseBranch: string): Promise<WorktreeInfo> {
    const branch = `agent/${taskId}`;
    const path = join(stateRoot, "worktrees", taskId);
    await mkdir(join(stateRoot, "worktrees"), { recursive: true });
    const existing = await this.run("git", ["worktree", "list", "--porcelain"], { cwd: repo });
    if (existing.code !== 0) throw new GitCommandError("worktree list", [], existing);
    const worktrees = parseWorktrees(existing.stdout);
    const listedAtPath = worktrees.find((item) => samePath(item.path, path));
    if (listedAtPath !== undefined && listedAtPath.branch !== `refs/heads/${branch}`) throw new Error(`worktree path is already assigned to ${listedAtPath.branch}`);
    const listedAtBranch = worktrees.find((item) => item.branch === `refs/heads/${branch}`);
    if (listedAtBranch !== undefined && !samePath(listedAtBranch.path, path)) throw new Error(`task branch is already assigned to ${listedAtBranch.path}`);
    if (listedAtPath !== undefined) return { taskId, branch, path };
    const probe = await this.run("git", ["show-ref", "--verify", `refs/heads/${branch}`], { cwd: repo });
    const args = probe.code === 0 ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, `origin/${baseBranch}`];
    const added = await this.run("git", args, { cwd: repo });
    if (added.code !== 0) throw new GitCommandError("worktree add", args, added);
    return { taskId, branch, path };
  }

  async snapshot(worktree: string, baseRef: string): Promise<GitSnapshot> {
    const [branch, head, status, files] = await Promise.all([
      this.read(worktree, ["branch", "--show-current"]),
      this.read(worktree, ["rev-parse", "HEAD"]),
      this.read(worktree, ["status", "--porcelain"]),
      this.read(worktree, ["diff", "--name-only", `${baseRef}...HEAD`]),
    ]);
    return { branch, head, clean: status === "", changedFiles: splitLines(files) };
  }

  async head(worktree: string): Promise<string> { return this.read(worktree, ["rev-parse", "HEAD"]); }
  async branch(worktree: string): Promise<string> { return this.read(worktree, ["branch", "--show-current"]); }
  async changedFiles(worktree: string, baseRef: string): Promise<string[]> { return splitLines(await this.read(worktree, ["diff", "--name-only", `${baseRef}...HEAD`])); }
  async isAncestor(ancestor: string, descendant: string, cwd: string): Promise<boolean> {
    const result = await this.run("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new GitCommandError("merge-base", ["--is-ancestor", ancestor, descendant], result);
  }
  async remoteContains(repo: string, head: string, remoteBranch: string): Promise<boolean> {
    const remoteHead = await this.remoteBranchHead(repo, remoteBranch);
    if (remoteHead === null) return false;
    if (remoteHead === head) return true;
    await this.must(repo, ["fetch", "origin", remoteBranch]);
    return this.isAncestor(head, `origin/${remoteBranch}`, repo);
  }
  async remoteBranchHead(repo: string, remoteBranch: string): Promise<string | null> {
    const result = await this.run("git", ["ls-remote", "origin", `refs/heads/${remoteBranch}`], { cwd: repo });
    if (result.code !== 0) throw new GitCommandError("ls-remote", ["origin", `refs/heads/${remoteBranch}`], result);
    const line = splitLines(result.stdout)[0];
    if (line === undefined) return null;
    const [head] = line.split(/\s+/);
    return head === undefined || head === "" ? null : head;
  }
  /** Reconstructs detached-worker completion facts without process/session memory. */
  async observeWorker(repo: string, worktree: string, baseRef: string, remoteBranch: string): Promise<WorkerGitObservation> {
    const snapshot = await this.snapshot(worktree, baseRef);
    const [baseHead, remoteHead] = await Promise.all([
      this.read(worktree, ["rev-parse", baseRef]),
      this.remoteBranchHead(repo, remoteBranch),
    ]);
    const baseAncestor = snapshot.head !== "" && await this.isAncestor(baseRef, snapshot.head, repo);
    const valid = snapshot.branch === remoteBranch && snapshot.head !== "" && baseAncestor;
    return { branch: snapshot.branch, currentHead: snapshot.head, baseHead, baseAncestor, remoteHead, valid, pushed: valid && snapshot.head !== baseHead && remoteHead === snapshot.head };
  }
  async fetch(repo: string, baseBranch: string): Promise<void> { await this.must(repo, ["fetch", "origin", baseBranch]); }

  /**
   * Creates only the single, orchestrator-owned v1 production clone. Existing
   * clones are never reset, checked out, or otherwise repaired automatically.
   */
  async ensureProductionClone(target: ProductionTargetConfig, stateRoot: string): Promise<ProductionTargetFacts> {
    assertProductionTargetDeclaration(target);
    if (!(await exists(target.targetRepo))) {
      await mkdir(PRODUCTION_TARGET_ROOT, { recursive: true });
      const cloned = await this.run("git", ["clone", "--branch", PRODUCTION_BASE_BRANCH, "--single-branch", productionOriginUrl(), target.targetRepo]);
      if (cloned.code !== 0) throw new GitCommandError("clone", ["--branch", PRODUCTION_BASE_BRANCH, "--single-branch", productionOriginUrl(), target.targetRepo], cloned);
    }
    return this.synchronizeProductionTarget(target, stateRoot);
  }

  /** Dispatch boundary: fetch first, then prove the clone is still exact and safe. */
  async synchronizeProductionTarget(target: ProductionTargetConfig, stateRoot: string): Promise<ProductionTargetFacts> {
    assertProductionTargetDeclaration(target);
    await this.assertProductionCloneStatic(target, stateRoot);
    await this.must(target.targetRepo, ["fetch", "origin", PRODUCTION_BASE_BRANCH]);
    return this.inspectProductionTarget(target, stateRoot);
  }

  /** Read-only production boundary inspection; it never fetches, checks out, or writes. */
  async inspectProductionTarget(target: ProductionTargetConfig, stateRoot: string): Promise<ProductionTargetFacts> {
    assertProductionTargetDeclaration(target);
    await this.assertProductionCloneStatic(target, stateRoot);
    const [originMaster, remoteMaster] = await Promise.all([
      this.read(target.targetRepo, ["rev-parse", `refs/remotes/origin/${PRODUCTION_BASE_BRANCH}`]),
      this.remoteBranchHead(target.targetRepo, PRODUCTION_BASE_BRANCH),
    ]);
    if (remoteMaster === null) throw new Error("production remote master is unavailable");
    if (originMaster !== remoteMaster) throw new Error("production origin/master does not match remote master; refusing stale target");
    const head = await this.head(target.targetRepo);
    if (head !== originMaster) throw new Error("production base checkout is not at origin/master; refusing automatic reset");
    const origin = await this.read(target.targetRepo, ["remote", "get-url", "origin"]);
    return { targetRepo: target.targetRepo, origin, branch: PRODUCTION_BASE_BRANCH, head, originMaster, remoteMaster };
  }

  async removeWorktree(repo: string, worktree: string): Promise<void> {
    await this.must(repo, ["worktree", "remove", "--force", worktree]);
  }

  /** Pure deterministic gate evaluation. No semantic/reviewer decision is inferred. */
  evaluateMergeGates(facts: MergeGateFacts): MergeGateResult {
    const checks: Array<[string, boolean]> = [
      ["required-tests", facts.requiredTestsPass],
      ["machine-validation", facts.machineValidationPass],
      ["scope", facts.scopePass],
      ["unexpected-diff", facts.unexpectedDiffPass],
      ["clean-worktree", facts.cleanWorktree],
      ["pushed-branch", facts.pushedBranch],
      ["dependency-base-consistency", facts.dependencyBasePass],
      ["reviewed-head-equality", facts.reviewedHead !== "" && facts.reviewedHead === facts.currentHead],
      ["no-unresolved-human-gate", !facts.unresolvedHumanGate],
      ["no-merge-barrier", !facts.activeMergeBarrier],
    ];
    return { pass: checks.every(([, pass]) => pass), failedGates: checks.filter(([, pass]) => !pass).map(([name]) => name), reviewedHead: facts.reviewedHead, currentHead: facts.currentHead };
  }

  /**
   * Performs the ordinary target-repository merge only after all facts pass.
   * Callers should use a disposable repository in tests; this adapter never
   * decides whether the reviewer was semantically correct.
   */
  async mergeReviewedBranch(request: MergeRequest): Promise<MergeGateResult> {
    const gates = this.evaluateMergeGates(request.facts);
    if (!gates.pass) return gates;
    const current = request.sourceWorktree === undefined ? request.facts.currentHead : await this.head(request.sourceWorktree);
    if (current !== request.facts.currentHead || current !== request.facts.reviewedHead) {
      return { ...gates, pass: false, failedGates: ["reviewed-head-equality"], currentHead: current };
    }
    let sourceRemoteHead: string | null;
    try {
      sourceRemoteHead = await this.remoteBranchHead(request.repo, request.sourceBranch);
    } catch {
      return { ...gates, pass: false, failedGates: ["source-remote-head-verification"], currentHead: current };
    }
    if (sourceRemoteHead !== request.facts.reviewedHead) {
      return { ...gates, pass: false, failedGates: ["source-remote-head-equality"], currentHead: current };
    }
    await this.must(request.repo, ["checkout", request.baseBranch]);
    await this.must(request.repo, ["merge", "--no-edit", request.sourceBranch]);
    await this.must(request.repo, ["push", "origin", request.baseBranch]);
    let remoteBaseContainsReviewed: boolean;
    try {
      remoteBaseContainsReviewed = await this.remoteContains(request.repo, request.facts.reviewedHead, request.baseBranch);
    } catch {
      remoteBaseContainsReviewed = false;
    }
    if (!remoteBaseContainsReviewed) return { ...gates, pass: false, failedGates: ["remote-base-head-verification"], currentHead: current };
    return gates;
  }

  async scopeCheck(worktree: string, baseRef: string, allowedPaths: readonly string[]): Promise<{ readonly pass: boolean; readonly unexpected: readonly string[] }> {
    const files = await this.changedFiles(worktree, baseRef);
    const unexpected = files.filter((file) => !allowedPaths.some((glob) => matchesGlob(file, glob)));
    return { pass: unexpected.length === 0, unexpected };
  }

  private async read(cwd: string, args: readonly string[]): Promise<string> {
    const result = await this.run("git", args, { cwd });
    if (result.code !== 0) throw new GitCommandError(args[0] ?? "git", args.slice(1), result);
    return result.stdout.trim();
  }
  private async must(cwd: string, args: readonly string[]): Promise<void> {
    const result = await this.run("git", args, { cwd });
    if (result.code !== 0) throw new GitCommandError(args[0] ?? "git", args.slice(1), result);
  }

  private async assertProductionCloneStatic(target: ProductionTargetConfig, stateRoot: string): Promise<void> {
    const inside = await this.run("git", ["rev-parse", "--is-inside-work-tree"], { cwd: target.targetRepo });
    if (inside.code !== 0 || inside.stdout.trim() !== "true") throw new Error("production target is not a Git working tree");
    const [origin, branch, status, worktreeOutput] = await Promise.all([
      this.read(target.targetRepo, ["remote", "get-url", "origin"]),
      this.read(target.targetRepo, ["branch", "--show-current"]),
      this.read(target.targetRepo, ["status", "--porcelain"]),
      this.read(target.targetRepo, ["worktree", "list", "--porcelain"]),
    ]);
    if (!originMatchesProduction(origin)) throw new Error("production clone origin does not match AZ-claude/slot");
    if (branch !== PRODUCTION_BASE_BRANCH) throw new Error("production clone must be attached to master; detached HEAD is not allowed");
    if (status !== "") throw new Error("production clone is dirty");
    assertProductionWorktreeOwnership(parseWorktrees(worktreeOutput), target.targetRepo, stateRoot);
  }
}

export function matchesGlob(path: string, glob: string): boolean {
  const segments = glob.split("/");
  let pattern = "^";
  for (const [index, segment] of segments.entries()) {
    if (segment === "**") {
      if (index > 0 && segments[index - 1] !== "**") pattern += "/";
      pattern += index === segments.length - 1 ? ".*" : "(?:[^/]+/)*";
      continue;
    }
    if (index > 0 && segments[index - 1] !== "**") pattern += "/";
    pattern += segment.split("*").map(escapeRegExp).join("[^/]*");
  }
  return new RegExp(`${pattern}$`).test(path);
}

function parseWorktrees(output: string): Array<{ path: string; branch: string }> {
  const result: Array<{ path: string; branch: string }> = [];
  let current: { path?: string; branch?: string } = {};
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) current.path = line.slice("worktree ".length);
    if (line.startsWith("branch ")) current.branch = line.slice("branch ".length);
    if (line === "" && current.path !== undefined) {
      result.push({ path: current.path, branch: current.branch ?? "" });
      current = {};
    }
  }
  if (current.path !== undefined) result.push({ path: current.path, branch: current.branch ?? "" });
  return result;
}
function splitLines(value: string): string[] { return value === "" ? [] : value.split(/\r?\n/).filter(Boolean); }
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => resolve(value).replace(/^\/private(?=\/)/, "");
  return normalize(left) === normalize(right);
}

function assertProductionTargetDeclaration(target: ProductionTargetConfig): void {
  if (resolve(target.targetRepo) !== PRODUCTION_TARGET_REPO || target.baseBranch !== PRODUCTION_BASE_BRANCH || target.githubRepo !== PRODUCTION_GITHUB_REPO) {
    throw new Error("production target declaration does not match the v1 slot/master boundary");
  }
}

function productionOriginUrl(): string { return `https://github.com/${PRODUCTION_GITHUB_REPO}.git`; }

function originMatchesProduction(origin: string): boolean {
  const normalized = origin.trim().replace(/\/$/, "").replace(/\.git$/, "");
  return normalized === `https://github.com/${PRODUCTION_GITHUB_REPO}` || normalized === `git@github.com:${PRODUCTION_GITHUB_REPO}` || normalized === `ssh://git@github.com/${PRODUCTION_GITHUB_REPO}`;
}

function assertProductionWorktreeOwnership(worktrees: readonly { path: string; branch: string }[], targetRepo: string, stateRoot: string): void {
  const base = worktrees.find((worktree) => samePath(worktree.path, targetRepo));
  if (base === undefined || base.branch !== `refs/heads/${PRODUCTION_BASE_BRANCH}`) throw new Error("production base checkout ownership is invalid or detached");
  const permittedRoot = resolve(stateRoot, "worktrees");
  for (const worktree of worktrees) {
    if (samePath(worktree.path, targetRepo)) continue;
    const path = resolve(worktree.path);
    const within = relative(permittedRoot, path);
    if (within === "" || within.startsWith("..") || within.includes("/..") || !worktree.branch.startsWith("refs/heads/agent/")) {
      throw new Error("production active worktree ownership is invalid");
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
