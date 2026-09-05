import { Checkpoint, ExecutionState, SessionLifecycle, WorkerRole } from "../config/index.js";

export interface ReconcileObservation { readonly checkpoint: Checkpoint; readonly issueState: ExecutionState | "closed"; readonly processAlive: boolean; readonly pushedHead: boolean; readonly sessionExists: boolean; readonly rateLimited: boolean; readonly now: Date; }
export type ReconcileAction = { readonly kind: "watch" | "validate" | "resume-luna" | "resume-terra" | "pause" | "wait-local-lease" | "cleanup-candidate" | "blocked-human" | "skip-completed"; readonly retryAt?: string; readonly reason?: string };

export interface SessionRecord { readonly sessionId: string; readonly taskId: string; readonly role: WorkerRole; readonly lifecycle: SessionLifecycle; }

export interface StaleLeaseReconciler { releaseStaleOwner(): Promise<boolean>; }

export async function reconcileStaleLocalLease(lease: StaleLeaseReconciler): Promise<"released" | "untouched"> {
  return await lease.releaseStaleOwner() ? "released" : "untouched";
}

export async function reconcileWithLocalLease(observation: ReconcileObservation, retryIntervalMs: number, lease: StaleLeaseReconciler): Promise<ReconcileAction> {
  const action = reconcile(observation, retryIntervalMs);
  if (action.kind === "wait-local-lease") await reconcileStaleLocalLease(lease);
  return action;
}

export function canCleanupSession(session: Pick<SessionRecord, "lifecycle">): boolean { return session.lifecycle === "RETIRED" || session.lifecycle === "CLEANUP"; }

export function nextSessionLifecycle(from: SessionLifecycle, to: SessionLifecycle): SessionLifecycle {
  const allowed: Record<SessionLifecycle, readonly SessionLifecycle[]> = { ACTIVE: ["RESUMABLE", "RETIRED"], RESUMABLE: ["ACTIVE", "RETIRED"], RETIRED: ["CLEANUP"], CLEANUP: [] };
  if (!allowed[from].includes(to)) throw new Error(`invalid session lifecycle ${from} -> ${to}`);
  return to;
}

export function cleanupSessions(sessions: readonly SessionRecord[]): readonly SessionRecord[] {
  return sessions.filter((session) => canCleanupSession(session));
}

export interface RevisionSyncFacts { readonly boardDigest: string; readonly manifestDigest: string; readonly expectedDigest: string; readonly directive: "resume" | "restart"; }

export function synchronizePlanRevision(facts: RevisionSyncFacts): "resume" | "restart" {
  if (facts.boardDigest === "" || facts.manifestDigest === "" || facts.expectedDigest === "") throw new Error("missing plan revision evidence");
  if (facts.boardDigest !== facts.manifestDigest || facts.boardDigest !== facts.expectedDigest) throw new Error("board/manifest revision evidence mismatch");
  return facts.directive;
}

export function reconcile(observation: ReconcileObservation, retryIntervalMs: number): ReconcileAction {
  const { checkpoint: cp } = observation;
  if (observation.issueState === "closed" && observation.pushedHead) return { kind: "skip-completed", reason: "closed task already has a pushed commit" };
  if (observation.rateLimited) return { kind: "pause", retryAt: new Date(observation.now.getTime() + retryIntervalMs).toISOString(), reason: "Codex rate limit" };
  if (cp.processOutcome === "lease-busy") return { kind: "wait-local-lease", retryAt: new Date(observation.now.getTime() + retryIntervalMs).toISOString(), reason: "shared local inference lease is busy or unavailable" };
  if (observation.issueState === "running" && observation.processAlive) return { kind: "watch" };
  if (observation.issueState === "running" && !observation.processAlive && observation.pushedHead) return { kind: "validate" };
  if (observation.issueState === "running" && !observation.processAlive && cp.sessionId !== null && observation.sessionExists) return { kind: "resume-luna" };
  if (observation.issueState === "reviewing" && !observation.processAlive && cp.sessionId !== null && observation.sessionExists) return { kind: "resume-terra" };
  if (observation.issueState === "closed") return { kind: "cleanup-candidate" };
  return { kind: "blocked-human", reason: "checkpoint/Issue/process/Git facts cannot be reconciled safely" };
}
