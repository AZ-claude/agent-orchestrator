import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { ManifestTask } from "../config/index.js";
import { GitAdapter, CommandResult, defaultCommandRunner } from "../git/index.js";

const execFile = promisify(nodeExecFile);

export interface ValidationEvidence {
  readonly branch: string;
  readonly head: string;
  readonly pushed: boolean;
  readonly clean: boolean;
  readonly changedFiles: readonly string[];
  readonly unexpectedFiles: readonly string[];
  readonly scope: "PASS" | "FAIL";
  readonly test: { readonly command: string; readonly exitCode: number; readonly pass: boolean };
  readonly dependencies: "PASS" | "FAIL";
  readonly branchCheck?: "PASS" | "FAIL";
  readonly worktreeCheck?: "PASS" | "FAIL";
  readonly baseAncestor?: "PASS" | "FAIL";
  readonly previousRework?: string;
}

export interface ReviewPacket extends ValidationEvidence {
  readonly taskId: string;
  readonly canonicalTask: string;
  readonly worktree: string;
  readonly baseRef: string;
  readonly acceptance: string;
}

export interface ValidationOptions {
  readonly worktree: string;
  readonly repo: string;
  readonly baseRef: string;
  readonly remoteBranch: string;
  readonly dependenciesPass: boolean;
  readonly acceptance?: string;
  readonly expectedBranch?: string;
  readonly expectedWorktree?: string;
  readonly previousRework?: string;
}

export class MachineValidator {
  constructor(private readonly git: GitAdapter = new GitAdapter()) {}

  async validate(task: ManifestTask, options: ValidationOptions): Promise<ReviewPacket> {
    const snapshot = await this.git.snapshot(options.worktree, options.baseRef);
    const scope = await this.git.scopeCheck(options.worktree, options.baseRef, task.allowedPaths);
    const pushed = await this.git.remoteContains(options.repo, snapshot.head, options.remoteBranch);
    const branchPass = snapshot.branch === (options.expectedBranch ?? `agent/${task.id}`);
    const worktreePass = options.expectedWorktree === undefined || options.worktree === options.expectedWorktree;
    const baseAncestor = await this.git.isAncestor(options.baseRef, snapshot.head, options.repo);
    const test = await runTest(task.test, options.worktree);
    return {
      taskId: task.id,
      canonicalTask: task.id,
      worktree: options.worktree,
      baseRef: options.baseRef,
      branch: snapshot.branch,
      head: snapshot.head,
      pushed,
      clean: snapshot.clean,
      changedFiles: snapshot.changedFiles,
      unexpectedFiles: scope.unexpected,
      scope: scope.pass ? "PASS" : "FAIL",
      test: { command: task.test, exitCode: test.code, pass: test.code === 0 },
      dependencies: options.dependenciesPass ? "PASS" : "FAIL",
      branchCheck: branchPass ? "PASS" : "FAIL",
      worktreeCheck: worktreePass ? "PASS" : "FAIL",
      baseAncestor: baseAncestor ? "PASS" : "FAIL",
      ...(options.previousRework === undefined ? {} : { previousRework: options.previousRework }),
      acceptance: options.acceptance ?? task.title,
    };
  }

  isPass(packet: ReviewPacket): boolean {
    return packet.pushed && packet.clean && packet.scope === "PASS" && packet.test.pass && packet.dependencies === "PASS" && packet.branchCheck === "PASS" && packet.worktreeCheck === "PASS" && packet.baseAncestor === "PASS";
  }
}

export function compactReviewPacket(packet: ReviewPacket): string {
  return [
    `Task: ${packet.taskId}`,
    `Canonical task: ${packet.canonicalTask}`,
    `Branch: ${packet.branch}`,
    `Commit: ${packet.head}`,
    `Worktree: ${packet.worktree}`,
    `Push: ${packet.pushed ? "PASS" : "FAIL"}`,
    `Git status: ${packet.clean ? "CLEAN" : "DIRTY"}`,
    `Changed files: ${packet.changedFiles.length === 0 ? "NONE" : packet.changedFiles.join(", ")}`,
    `Scope check: ${packet.scope}${packet.unexpectedFiles.length ? ` (${packet.unexpectedFiles.join(", ")})` : ""}`,
    `Test: ${packet.test.pass ? "PASS" : "FAIL"} (${packet.test.command})`,
    `Dependencies: ${packet.dependencies}`,
    `Branch/worktree: ${packet.branchCheck ?? "UNKNOWN"}/${packet.worktreeCheck ?? "UNKNOWN"}`,
    `Base ancestor: ${packet.baseAncestor ?? "UNKNOWN"}`,
    ...(packet.previousRework === undefined ? [] : [`Previous rework: ${packet.previousRework}`]),
    `Acceptance: ${packet.acceptance}`,
  ].join("\n");
}

async function runTest(command: string, cwd: string): Promise<CommandResult> {
  const args = splitCommand(command);
  const executable = args.shift();
  if (executable === undefined) return { stdout: "", stderr: "empty test command", code: 1 };
  try {
    const result = await execFile(executable, args, { cwd, maxBuffer: 4 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? "", code: typeof failure.code === "number" ? failure.code : 1 };
  }
}

export function splitCommand(command: string): string[] {
  const result: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  for (const match of command.matchAll(pattern)) result.push(match[1] ?? match[2] ?? match[3] ?? "");
  return result;
}
