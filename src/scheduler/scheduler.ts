import { ExecutionState, ManifestTask, ParallelPolicy, TaskManifest } from "../config/index.js";

export interface SchedulerTask { readonly task: ManifestTask; readonly state: ExecutionState; readonly dependenciesClosed: boolean; readonly humanGateSatisfied: boolean; readonly issueOpen?: boolean; readonly dependenciesAncestor?: boolean; }
export interface SchedulerSnapshot { readonly tasks: readonly SchedulerTask[]; readonly running: readonly { taskId: string; parallel: ParallelPolicy }[]; readonly maxLunaWorkers: number; }

export class DeterministicScheduler {
  ready(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    const running = snapshot.running;
    const anyExclusive = running.some((item) => item.parallel === "EXCLUSIVE");
    const safeCount = running.filter((item) => item.parallel === "SAFE").length;
    if (anyExclusive) return [];
    const availableSafe = Math.max(0, snapshot.maxLunaWorkers - safeCount);
    const result: ManifestTask[] = [];
    for (const item of snapshot.tasks) {
      if (item.state !== "ready" || item.issueOpen !== true || !item.dependenciesClosed || item.dependenciesAncestor !== true || (item.task.humanGate && !item.humanGateSatisfied)) continue;
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
