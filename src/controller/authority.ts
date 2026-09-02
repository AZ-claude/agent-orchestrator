import { HumanGateReason, PlanConflictClaim } from "../config/index.js";

export const AUTHORITY_MATRIX = {
  requirements: ["user-chatgpt"],
  plan: ["terra"],
  implementation: ["worker"],
  semanticReview: ["reviewer"],
  deterministicValidation: ["daemon", "reviewer"],
  normalMerge: ["daemon"],
  sessionLifecycle: ["daemon"],
  finalAcceptance: ["terra"],
} as const;

export type AuthorityRole = "user-chatgpt" | "terra" | "worker" | "reviewer" | "daemon";

export class AuthorityError extends Error {
  constructor(readonly operation: string, readonly role: AuthorityRole) {
    super(`${role} cannot perform ${operation}`);
    this.name = "AuthorityError";
  }
}

export function assertCanChangePlan(role: AuthorityRole): void {
  if (role !== "terra") throw new AuthorityError("task-board/DAG meaning change", role);
}

export function assertCanMerge(role: AuthorityRole): void {
  if (role !== "daemon") throw new AuthorityError("normal task merge", role);
}

export function humanGateFor(reason: HumanGateReason): { readonly reason: HumanGateReason; readonly required: true } {
  return { reason, required: true };
}

export interface PersistedPlanClaim { readonly claim: PlanConflictClaim; readonly confirmed: boolean; }

/** Workers/reviewers may submit evidence, but only reviewer confirmation opens revision. */
export function routePlanConflict(claim: PlanConflictClaim, confirmation: "PLAN_CONFLICT_CONFIRMED" | "NOT_CONFIRMED"): PersistedPlanClaim {
  return { claim, confirmed: confirmation === "PLAN_CONFLICT_CONFIRMED" };
}

export function classifyRecoveryExhaustion(kind: "PLAN_CONFLICT_SUSPICION" | "PURE_IMPLEMENTATION_FAILURE"): "PLAN_CONFLICT_REVIEW" | "BLOCKED_HUMAN" {
  return kind === "PLAN_CONFLICT_SUSPICION" ? "PLAN_CONFLICT_REVIEW" : "BLOCKED_HUMAN";
}
