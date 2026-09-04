import { CodexInvocation, CodexLifecycleObservation, CodexProcess, observeCodexOutput, spawnCodex } from "../codex/index.js";
import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { WorkerRole } from "../config/index.js";

export interface LunaRunResult extends CodexLifecycleObservation {
  readonly pid: number | undefined;
  readonly stderr: readonly string[];
  readonly recoveryEvent: "success" | "rate-limit" | "crash" | "failed" | "spawn-error";
  readonly attempt: number;
  readonly logPath: string;
}
export type ProcessFactory = (invocation: CodexInvocation, cwd: string) => CodexProcess;
export interface LunaRunnerOptions { readonly logRoot?: string; readonly maxResumeAttempts?: number; }

export interface RecoveryEvidence {
  readonly taskId: string;
  readonly acceptance: string;
  readonly assumptions: readonly string[];
  readonly invariants: readonly string[];
  readonly branch: string;
  readonly head: string;
  readonly machineValidation: string;
  readonly testFailures: readonly string[];
  readonly reviewerFindings: readonly string[];
  readonly attemptedFixSummary: string;
}

export interface WorkerSessionStart {
  readonly role: WorkerRole;
  readonly sessionId: string | null;
  readonly fresh: boolean;
  readonly evidence?: RecoveryEvidence;
}

export class LunaRunner {
  private readonly logRoot: string;
  private readonly maxResumeAttempts: number;
  private readonly active = new Map<number, CodexProcess>();
  constructor(private readonly createProcess: ProcessFactory = spawnCodex, options: LunaRunnerOptions = {}) {
    this.logRoot = options.logRoot ?? join(homedir(), ".local", "state", "agent-orchestrator", "logs");
    this.maxResumeAttempts = options.maxResumeAttempts ?? 2;
  }

  start(prompt: string, worktree: string): Promise<LunaRunResult> {
    return this.run({ kind: "new", prompt }, worktree, 1);
  }

  /** Recovery is intentionally a new invocation; it never resumes Primary history. */
  startRecovery(evidence: RecoveryEvidence, prompt: string, worktree: string): Promise<LunaRunResult> {
    return this.run({ kind: "new", prompt: `${prompt}\n\nDurable recovery evidence:\n${JSON.stringify(evidence)}` }, worktree, 1);
  }
  resume(sessionId: string, prompt: string, worktree: string, attempt = 1): Promise<LunaRunResult> {
    if (attempt < 1 || attempt > this.maxResumeAttempts) throw new Error(`Luna resume attempt must be between 1 and ${this.maxResumeAttempts}`);
    return this.run({ kind: "resume", sessionId, prompt }, worktree, attempt);
  }

  async resumeWithRetry(sessionId: string, prompt: string, worktree: string): Promise<LunaRunResult> {
    let result = await this.resume(sessionId, prompt, worktree, 1);
    while (result.outcome === "crash" && result.attempt < this.maxResumeAttempts) {
      result = await this.resume(sessionId, prompt, worktree, result.attempt + 1);
    }
    return result;
  }

  async retire(pid?: number): Promise<boolean> {
    if (pid === undefined) return false;
    const process = this.active.get(pid);
    if (process === undefined) return false;
    process.kill("SIGTERM");
    return true;
  }

  private async run(invocation: CodexInvocation, worktree: string, attempt: number): Promise<LunaRunResult> {
    const process = this.createProcess(invocation, worktree);
    if (process.pid !== undefined) this.active.set(process.pid, process);
    try {
      const [stdout, stderr, exitCode, exitReason] = await Promise.all([collect(process.stdout), collect(process.stderr), process.exitCode, process.exitReason ?? Promise.resolve("exit" as const)]);
      const observation = observeCodexOutput(stdout, exitCode, exitReason);
      const logPath = join(this.logRoot, `${basename(worktree)}.jsonl`);
      await mkdir(this.logRoot, { recursive: true });
      await appendFile(logPath, [...stdout, ...stderr.map((line) => JSON.stringify({ type: "stderr", line }))].map((line) => `${line}\n`).join(""), "utf8");
      return { ...observation, pid: process.pid, stderr, recoveryEvent: observation.outcome, attempt, logPath };
    } finally {
      if (process.pid !== undefined) this.active.delete(process.pid);
    }
  }
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const line of lines) result.push(line);
  return result;
}
