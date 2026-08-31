import { Checkpoint, ExecutionState } from "../config/index.js";

export interface ReconcileObservation { readonly checkpoint: Checkpoint; readonly issueState: ExecutionState | "closed"; readonly processAlive: boolean; readonly pushedHead: boolean; readonly sessionExists: boolean; readonly rateLimited: boolean; readonly now: Date; }
export type ReconcileAction = { readonly kind: "watch" | "validate" | "resume-luna" | "resume-terra" | "pause" | "cleanup-candidate" | "blocked-human" | "skip-completed"; readonly retryAt?: string; readonly reason?: string };

export function reconcile(observation: ReconcileObservation, retryIntervalMs: number): ReconcileAction {
  const { checkpoint: cp } = observation;
  if (observation.issueState === "closed" && observation.pushedHead) return { kind: "skip-completed", reason: "closed task already has a pushed commit" };
  if (observation.rateLimited) return { kind: "pause", retryAt: new Date(observation.now.getTime() + retryIntervalMs).toISOString(), reason: "Codex rate limit" };
  if (observation.issueState === "running" && observation.processAlive) return { kind: "watch" };
  if (observation.issueState === "running" && !observation.processAlive && observation.pushedHead) return { kind: "validate" };
  if (observation.issueState === "running" && !observation.processAlive && cp.sessionId !== null && observation.sessionExists) return { kind: "resume-luna" };
  if (observation.issueState === "reviewing" && !observation.processAlive && cp.sessionId !== null && observation.sessionExists) return { kind: "resume-terra" };
  if (observation.issueState === "closed") return { kind: "cleanup-candidate" };
  return { kind: "blocked-human", reason: "checkpoint/Issue/process/Git facts cannot be reconciled safely" };
}
