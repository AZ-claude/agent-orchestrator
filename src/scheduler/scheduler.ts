import { ExecutionState, ManifestTask, ParallelPolicy, TaskManifest } from "../config/index.js";

export interface SchedulerTask { readonly task: ManifestTask; readonly state: ExecutionState; readonly dependenciesClosed: boolean; readonly humanGateSatisfied: boolean; }
export interface SchedulerSnapshot { readonly tasks: readonly SchedulerTask[]; readonly running: readonly { taskId: string; parallel: ParallelPolicy }[]; readonly maxLunaWorkers: number; }

export class DeterministicScheduler {
  ready(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    const running = snapshot.running;
    const anyExclusive = running.some((item) => item.parallel === "EXCLUSIVE");
    const safeCount = running.filter((item) => item.parallel === "SAFE").length;
    if (anyExclusive) return [];
    const candidates = snapshot.tasks
      .filter((item) => item.state === "ready" && item.dependenciesClosed && (!item.task.humanGate || item.humanGateSatisfied))
      .filter((item) => item.task.parallel === "EXCLUSIVE" ? running.length === 0 : safeCount < snapshot.maxLunaWorkers);
    return candidates.slice(0, Math.max(0, snapshot.maxLunaWorkers - safeCount)).map((item) => item.task);
  }

  planDispatch(snapshot: SchedulerSnapshot): readonly ManifestTask[] {
    const candidates = this.ready(snapshot);
    const exclusive = candidates.find((task) => task.parallel === "EXCLUSIVE");
    return exclusive === undefined ? candidates : snapshot.running.length === 0 ? [exclusive] : [];
  }
}

export function schedulerTasks(manifest: TaskManifest, states: ReadonlyMap<string, ExecutionState>, closed: ReadonlySet<string>, humanGates: ReadonlySet<string>): SchedulerTask[] {
  return manifest.tasks.map((task) => ({ task, state: states.get(task.id) ?? "ready", dependenciesClosed: task.dependsOn.every((dependency) => closed.has(dependency)), humanGateSatisfied: humanGates.has(task.id) }));
}
