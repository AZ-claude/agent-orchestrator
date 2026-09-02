import { ExecutionState, ManifestTask, ParallelPolicy, PlanConflictClaim, PlanReviewResult, TaskManifest } from "../config/index.js";

export interface SchedulerTask { readonly task: ManifestTask; readonly state: ExecutionState; readonly dependenciesClosed: boolean; readonly humanGateSatisfied: boolean; readonly issueOpen?: boolean; readonly dependenciesAncestor?: boolean; readonly pausedByPlanRevision?: boolean; }
export interface SchedulerSnapshot { readonly tasks: readonly SchedulerTask[]; readonly running: readonly { taskId: string; parallel: ParallelPolicy }[]; readonly maxLunaWorkers: number; readonly mergeBarrierActive?: boolean; }

export interface PlanRevisionState { readonly active: boolean; readonly mergeBarrierActive: boolean; readonly conflictTaskId: string; readonly affectedTaskIds: readonly string[]; readonly claim: PlanConflictClaim; }

export function confirmPlanConflict(claim: PlanConflictClaim, reviewerResult: PlanReviewResult): PlanRevisionState | null {
  if (reviewerResult !== "PLAN_CONFLICT_CONFIRMED") return null;
  return { active: true, mergeBarrierActive: true, conflictTaskId: claim.taskId, affectedTaskIds: [], claim };
}

export function affectedByPlanConflict(manifest: TaskManifest, taskId: string): readonly string[] {
  const affected = new Set<string>([taskId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of manifest.tasks) if (!affected.has(task.id) && task.dependsOn.some((dependency) => affected.has(dependency))) { affected.add(task.id); changed = true; }
  }
  return manifest.tasks.map((task) => task.id).filter((id) => affected.has(id));
}

export function activatePlanRevision(manifest: TaskManifest, claim: PlanConflictClaim): PlanRevisionState {
  return { active: true, mergeBarrierActive: true, conflictTaskId: claim.taskId, affectedTaskIds: affectedByPlanConflict(manifest, claim.taskId), claim };
}

export function beginPlanRevision(manifest: TaskManifest, claim: PlanConflictClaim, reviewerResult: PlanReviewResult): PlanRevisionState | null {
  if (reviewerResult !== "PLAN_CONFLICT_CONFIRMED") return null;
  return activatePlanRevision(manifest, claim);
}

export function mergeAllowed(mergeBarrierActive: boolean): boolean { return !mergeBarrierActive; }

export function resumePlanRevision(state: PlanRevisionState, directive: "resume" | "restart", revisedTaskIds: readonly string[]): PlanRevisionState {
  if (!state.active) throw new Error("cannot resume an inactive plan revision");
  if (revisedTaskIds.some((id) => !state.affectedTaskIds.includes(id))) throw new Error("resume directive contains an unaffected task");
  return { ...state, active: false, mergeBarrierActive: false, ...(directive === "restart" ? { affectedTaskIds: revisedTaskIds } : {}) };
}

export class DeterministicScheduler {
  ready(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    const running = snapshot.running;
    const anyExclusive = running.some((item) => item.parallel === "EXCLUSIVE");
    const safeCount = running.filter((item) => item.parallel === "SAFE").length;
    if (anyExclusive) return [];
    const availableSafe = Math.max(0, snapshot.maxLunaWorkers - safeCount);
    const result: ManifestTask[] = [];
    for (const item of snapshot.tasks) {
      if (item.state !== "ready" || item.pausedByPlanRevision === true || item.issueOpen !== true || !item.dependenciesClosed || item.dependenciesAncestor !== true || (item.task.humanGate && !item.humanGateSatisfied)) continue;
      if (item.task.parallel === "EXCLUSIVE") {
        if (running.length === 0 && result.length === 0) return [item.task];
        continue;
      }
      if (result.length < availableSafe) result.push(item.task);
    }
    return result;
  }

  planDispatch(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    return this.ready(snapshot);
  }
}

const TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  ready: ["running", "blocked-human", "paused"],
  running: ["paused", "worker-done", "blocked-human"],
  paused: ["running", "blocked-human"],
  "worker-done": ["reviewing", "paused", "blocked-human"],
  reviewing: ["rework", "blocked-human"],
  rework: ["running", "blocked-human"],
  "blocked-human": [],
};
export const SCHEDULER_TRANSITIONS = TRANSITIONS;
export function canTransition(from: ExecutionState, to: ExecutionState): boolean { return TRANSITIONS[from].includes(to); }
export function transitionState(from: ExecutionState, to: ExecutionState): ExecutionState {
  if (!canTransition(from, to)) throw new Error(`invalid scheduler transition ${from} -> ${to}`);
  return to;
}

export function schedulerTasks(manifest: TaskManifest, states: ReadonlyMap<string, ExecutionState>, closed: ReadonlySet<string>, humanGates: ReadonlySet<string>, issueOpen: ReadonlySet<string> = new Set(), dependenciesAncestor: ReadonlySet<string> = new Set()): SchedulerTask[] {
  return manifest.tasks.map((task) => ({ task, state: states.get(task.id) ?? "ready", dependenciesClosed: task.dependsOn.every((dependency) => closed.has(dependency)), humanGateSatisfied: humanGates.has(task.id), issueOpen: issueOpen.has(task.id), dependenciesAncestor: dependenciesAncestor.has(task.id) }));
}
