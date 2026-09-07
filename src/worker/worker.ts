import { WorkerProvider, WorkerRole } from "../config/index.js";
import type { LeaseEvidence } from "../opencode/lease.js";
import type { WorkerRunRouting } from "./routing.js";

export type AvailabilityLimitReason = "RATE_LIMIT" | "USAGE_LIMIT" | "QUOTA_LIMIT";
export type WorkerOutcome = "success" | "availability-limit" | "crash" | "failed" | "spawn-error" | "lease-busy";

export interface WorkerRecoveryEvidence {
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

export interface WorkerRunResult {
  readonly provider: WorkerProvider;
  readonly adapter: "codex/luna" | "opencode";
  readonly role: WorkerRole;
  readonly sessionId: string | null;
  readonly pid: number | undefined;
  readonly outcome: WorkerOutcome;
  readonly availabilityReason?: AvailabilityLimitReason;
  readonly exitCode: number | null;
  readonly stderr: readonly string[];
  readonly logPath: string;
  readonly fresh: boolean;
  readonly resumable: boolean;
  readonly lease?: LeaseEvidence;
}

/** Facts available immediately after a worker process is accepted. */
export interface WorkerProcessStarted {
  readonly provider: WorkerProvider;
  readonly adapter: "codex/luna" | "opencode";
  readonly role: WorkerRole;
  readonly sessionId: string | null;
  readonly pid: number | undefined;
  readonly logPath: string;
  readonly fresh: boolean;
  readonly resumable: boolean;
  readonly lease?: LeaseEvidence;
}

/** A non-blocking process start with a separately observed terminal result. */
export interface WorkerProcessHandle {
  readonly started: WorkerProcessStarted;
  readonly completion: Promise<WorkerRunResult>;
}

export type WorkerProcessTransitionListener = (started: WorkerProcessStarted, routing: WorkerRunRouting) => Promise<void> | void;

/** The only lifecycle facts the controller needs from an implementation worker. */
export interface ImplementationWorkerAdapter {
  readonly provider: WorkerProvider;
  start(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult>;
  readonly startDetached?: (prompt: string, worktree: string, role: WorkerRole) => Promise<WorkerProcessHandle>;
  resume(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult>;
  readonly resumeDetached?: (sessionId: string, prompt: string, worktree: string, role: WorkerRole) => Promise<WorkerProcessHandle>;
  startRecovery(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerRunResult>;
  readonly startRecoveryDetached?: (evidence: WorkerRecoveryEvidence, prompt: string, worktree: string) => Promise<WorkerProcessHandle>;
  retire(pid?: number): Promise<boolean>;
}
