import { execFile as nodeExecFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

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
    return this.isAncestor(head, `origin/${remoteBranch}`, repo);
  }
  async fetch(repo: string, baseBranch: string): Promise<void> { await this.must(repo, ["fetch", "origin", baseBranch]); }

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
    await this.must(request.repo, ["checkout", request.baseBranch]);
    await this.must(request.repo, ["merge", "--no-edit", request.sourceBranch]);
    await this.must(request.repo, ["push", "origin", request.baseBranch]);
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
