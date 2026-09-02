export * from "./runner.js";

export interface ReviewFinding {
  readonly reason: string;
  readonly findingId?: string;
  readonly testFailureSignature?: string;
  readonly diffFingerprint?: string;
}

export type IndependentReview = "APPROVE" | ({ readonly result: "REWORK"; readonly reason: string; readonly findingId?: string; readonly testFailureSignature?: string; readonly diffFingerprint?: string }) | ({ readonly result: "PLAN_CONFLICT"; readonly claim: import("../config/index.js").PlanConflictClaim }) | ({ readonly result: "PLAN_CONFLICT_CONFIRMED"; readonly claim: import("../config/index.js").PlanConflictClaim }) | ({ readonly result: "NOT_CONFIRMED"; readonly reason: string });

export interface IndependentReviewer {
  review(packet: import("../validation/index.js").ReviewPacket): Promise<IndependentReview | { readonly result: "CAPABILITY_UNAVAILABLE"; readonly reason: string }>;
}

export function normalizeFinding(value: string): string {
  return value.toLowerCase().replace(/\b(?:line|column|attempt|cycle)\s*\d+\b/g, "").replace(/[0-9a-f]{7,40}/g, "<hash>").replace(/\s+/g, " ").trim();
}

export function earlyStuck(reviews: readonly ReviewFinding[]): boolean {
  const last = reviews.at(-1);
  const previous = reviews.at(-2);
  if (last === undefined || previous === undefined) return false;
  const same = (left: string | undefined, right: string | undefined): boolean => left !== undefined && right !== undefined && normalizeFinding(left) === normalizeFinding(right);
  return same(last.findingId ?? last.reason, previous.findingId ?? previous.reason) || same(last.testFailureSignature, previous.testFailureSignature) || same(last.diffFingerprint, previous.diffFingerprint);
}

export const MAX_REVIEW_CYCLES = 3;
