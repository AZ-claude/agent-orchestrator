import { PlanConflictClaim, WorkerRole } from "../config/index.js";
import { IndependentReview, MAX_REVIEW_CYCLES, ReviewFinding, earlyStuck } from "../luna/index.js";
import { ReviewPacket } from "../validation/index.js";

export interface IndependentReviewer {
  review(packet: ReviewPacket): Promise<IndependentReview | { readonly result: "CAPABILITY_UNAVAILABLE"; readonly reason: string }>;
}

export interface DeterministicMergeResult { readonly pass: boolean; readonly failedGates?: readonly string[]; }

export interface RecoveryReviewEvidence {
  readonly taskId: string;
  readonly role: WorkerRole;
  readonly head: string;
  readonly branch: string;
  readonly worktree: string;
  readonly machineValidation: string;
  readonly testFailures: readonly string[];
  readonly acceptance: string;
  readonly assumptions: readonly string[];
  readonly invariants: readonly string[];
  readonly reviewerFindings: readonly string[];
  readonly attemptedFixSummary: string;
}

export interface ControllerDependencies {
  readonly validate: () => Promise<ReviewPacket>;
  readonly reviewer: IndependentReviewer;
  /** Deterministic daemon gate + merge; it must not infer semantic approval. */
  readonly mergeReviewed: (packet: ReviewPacket) => Promise<DeterministicMergeResult>;
  readonly resumeLuna: (reason: string) => Promise<void>;
  readonly startRecovery?: (evidence: RecoveryReviewEvidence) => Promise<void>;
  readonly retirePrimary?: () => Promise<void>;
  readonly setState: (state: "reviewing" | "rework" | "blocked-human" | "paused") => Promise<void>;
  readonly closeIssue: () => Promise<void>;
  readonly unlockDependents?: () => Promise<void>;
  readonly cleanup?: (role: WorkerRole) => Promise<void>;
  readonly recordReview?: (role: WorkerRole, result: IndependentReview | { readonly result: "CAPABILITY_UNAVAILABLE"; readonly reason: string }) => Promise<void>;
  readonly onPlanConflict?: (claim: PlanConflictClaim) => Promise<void>;
}

export interface ControllerResult {
  readonly status: "approved" | "blocked-human" | "plan-conflict";
  readonly reviewRounds: number;
  readonly packet: ReviewPacket;
  readonly workerRole: WorkerRole;
  readonly recoveryUsed: boolean;
  readonly failedGates?: readonly string[];
  readonly blockedReason?: "MACHINE_VALIDATION_FAILED" | "CAPABILITY_UNAVAILABLE" | "MERGE_GATE_FAILED" | "RECOVERY_EXHAUSTED";
}

/** Worker -> Independent Reviewer -> deterministic gate; Terra is absent. */
export class ReviewCloseController {
  constructor(private readonly deps: ControllerDependencies) {}

  async processWorkerDone(): Promise<ControllerResult> {
    let packet = await this.deps.validate();
    let role: WorkerRole = "primary";
    let cycle = 0;
    let reviewRounds = 0;
    let recoveryUsed = false;
    const findings: ReviewFinding[] = [];

    for (;;) {
      if (!machineValidationPassed(packet)) {
        await this.deps.setState("blocked-human");
        return { status: "blocked-human", reviewRounds, packet, workerRole: role, recoveryUsed, blockedReason: "MACHINE_VALIDATION_FAILED" };
      }
      cycle += 1;
      reviewRounds += 1;
      await this.deps.setState("reviewing");
      const independent = await this.deps.reviewer.review(packet);
      await this.deps.recordReview?.(role, independent);

      if (independent === "APPROVE") {
        const merged = await this.merge(packet);
        if (!merged.pass) {
          await this.deps.setState("blocked-human");
          return { status: "blocked-human", reviewRounds, packet, workerRole: role, recoveryUsed, failedGates: merged.failedGates ?? ["deterministic-merge-gates"], blockedReason: "MERGE_GATE_FAILED" };
        }
        await this.deps.closeIssue();
        await this.deps.unlockDependents?.();
        await this.deps.cleanup?.(role);
        return { status: "approved", reviewRounds, packet, workerRole: role, recoveryUsed };
      }
      if (independent.result === "CAPABILITY_UNAVAILABLE") {
        await this.deps.setState("blocked-human");
        return { status: "blocked-human", reviewRounds, packet, workerRole: role, recoveryUsed, blockedReason: "CAPABILITY_UNAVAILABLE" };
      }
      if (independent.result === "PLAN_CONFLICT" || independent.result === "PLAN_CONFLICT_CONFIRMED") {
        await this.deps.onPlanConflict?.(independent.claim);
        await this.deps.setState("paused");
        return { status: "plan-conflict", reviewRounds, packet, workerRole: role, recoveryUsed };
      }

      const finding: ReviewFinding = { reason: independent.reason, ...("findingId" in independent && independent.findingId === undefined ? {} : "findingId" in independent ? { findingId: independent.findingId } : {}), ...("testFailureSignature" in independent && independent.testFailureSignature === undefined ? {} : "testFailureSignature" in independent ? { testFailureSignature: independent.testFailureSignature } : {}), ...("diffFingerprint" in independent && independent.diffFingerprint === undefined ? {} : "diffFingerprint" in independent ? { diffFingerprint: independent.diffFingerprint } : {}) };
      findings.push(finding);
      const stuck = earlyStuck(findings) || cycle >= MAX_REVIEW_CYCLES;
      if (stuck) {
        if (recoveryUsed || this.deps.startRecovery === undefined) {
          await this.deps.setState("blocked-human");
          return { status: "blocked-human", reviewRounds, packet, workerRole: role, recoveryUsed, blockedReason: "RECOVERY_EXHAUSTED" };
        }
        await this.deps.retirePrimary?.();
        recoveryUsed = true;
        role = "recovery";
        cycle = 0;
        await this.deps.startRecovery({ taskId: packet.taskId, role: "recovery", head: packet.head, branch: packet.branch, worktree: packet.worktree, machineValidation: JSON.stringify({ clean: packet.clean, pushed: packet.pushed, scope: packet.scope, dependencies: packet.dependencies, baseAncestor: packet.baseAncestor }), testFailures: packet.test.pass ? [] : [packet.test.command], acceptance: packet.acceptance, assumptions: packet.assumptions ?? [], invariants: packet.invariants ?? [], reviewerFindings: findings.map((item) => item.reason), attemptedFixSummary: independent.reason });
        findings.length = 0;
        packet = await this.deps.validate();
        continue;
      }
      await this.deps.setState("rework");
      await this.deps.resumeLuna(independent.reason);
      packet = await this.deps.validate();
    }
  }

  private async merge(packet: ReviewPacket): Promise<DeterministicMergeResult> {
    return this.deps.mergeReviewed(packet);
  }
}

function machineValidationPassed(packet: ReviewPacket): boolean {
  return packet.pushed && packet.clean && packet.scope === "PASS" && packet.test.pass && packet.dependencies === "PASS" && packet.branchCheck === "PASS" && packet.worktreeCheck === "PASS" && packet.baseAncestor === "PASS";
}

export { machineValidationPassed };
