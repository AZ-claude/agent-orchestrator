import { WorkerProvider, WorkerRole } from "../config/index.js";
import { LunaRunner, RecoveryEvidence } from "../luna/index.js";
import { ImplementationWorkerAdapter, WorkerRecoveryEvidence, WorkerRunResult } from "./worker.js";

export class CloudWorkerAdapter implements ImplementationWorkerAdapter {
  readonly provider: WorkerProvider = "cloud";
  constructor(private readonly luna: LunaRunner) {}

  async start(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    return normalize(await this.luna.start(prompt, worktree), role, true);
  }

  async resume(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    return normalize(await this.luna.resumeWithRetry(sessionId, prompt, worktree), role, false);
  }

  async startRecovery(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerRunResult> {
    return normalize(await this.luna.startRecovery(evidence as RecoveryEvidence, prompt, worktree), "recovery", true);
  }

  async retire(pid?: number): Promise<boolean> {
    return this.luna.retire(pid);
  }
}

function normalize(result: Awaited<ReturnType<LunaRunner["start"]>>, role: WorkerRole, fresh: boolean): WorkerRunResult {
  return {
    provider: "cloud",
    adapter: "codex/luna",
    role,
    sessionId: result.sessionId,
    pid: result.pid,
    outcome: result.outcome === "rate-limit" ? "availability-limit" : result.outcome,
    ...(result.outcome === "rate-limit" ? { availabilityReason: "RATE_LIMIT" as const } : {}),
    exitCode: result.exitCode,
    stderr: result.stderr,
    logPath: result.logPath,
    fresh,
    resumable: result.sessionId !== null && result.outcome === "success",
  };
}
