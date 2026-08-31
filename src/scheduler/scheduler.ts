import { ExecutionState, ManifestTask, ParallelPolicy, TaskManifest } from "../config/index.js";

export interface SchedulerTask { readonly task: ManifestTask; readonly state: ExecutionState; readonly dependenciesClosed: boolean; readonly humanGateSatisfied: boolean; readonly issueOpen?: boolean; readonly dependenciesAncestor?: boolean; }
export interface SchedulerSnapshot { readonly tasks: readonly SchedulerTask[]; readonly running: readonly { taskId: string; parallel: ParallelPolicy }[]; readonly maxLunaWorkers: number; }

export class DeterministicScheduler {
  ready(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    const running = snapshot.running;
    const anyExclusive = running.some((item) => item.parallel === "EXCLUSIVE");
    const safeCount = running.filter((item) => item.parallel === "SAFE").length;
    if (anyExclusive) return [];
    const candidates = snapshot.tasks
      .filter((item) => item.state === "ready" && item.issueOpen !== false && item.dependenciesClosed && item.dependenciesAncestor !== false && (!item.task.humanGate || item.humanGateSatisfied))
      .filter((item) => item.task.parallel === "EXCLUSIVE" ? running.length === 0 : safeCount < snapshot.maxLunaWorkers);
    return candidates.slice(0, Math.max(0, snapshot.maxLunaWorkers - safeCount)).map((item) => item.task);
  }

  planDispatch(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    const candidates = this.ready(snapshot);
    const exclusiveIndex = candidates.findIndex((task) => task.parallel === "EXCLUSIVE");
    if (exclusiveIndex < 0) return candidates;
    const exclusive = candidates[exclusiveIndex];
    return exclusiveIndex === 0 && snapshot.running.length === 0 && exclusive !== undefined ? [exclusive] : candidates.slice(0, exclusiveIndex);
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

export function schedulerTasks(manifest: TaskManifest, states: ReadonlyMap<string, ExecutionState>, closed: ReadonlySet<string>, humanGates: ReadonlySet<string>): SchedulerTask[] {
  return manifest.tasks.map((task) => ({ task, state: states.get(task.id) ?? "ready", dependenciesClosed: task.dependsOn.every((dependency) => closed.has(dependency)), humanGateSatisfied: humanGates.has(task.id) }));
}
