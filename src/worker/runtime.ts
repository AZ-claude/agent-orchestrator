import { Checkpoint } from "../config/index.js";
import { CheckpointStore } from "../checkpoint/index.js";
import { addWorkerEvidence } from "./evidence.js";
import { WorkerDispatcher, WorkerDispatchResult } from "./routing.js";
import { WorkerRecoveryEvidence } from "./worker.js";

export interface DurableWorkerDispatchOptions {
  readonly checkpoint: Checkpoint;
  readonly prompt: string;
  readonly worktree: string;
  readonly runId: string;
  readonly localModel?: string;
  readonly recoveryEvidence?: WorkerRecoveryEvidence;
}

/** Dispatches through the router and atomically records only restart-safe facts. */
export class DurableWorkerRuntime {
  constructor(private readonly dispatcher: WorkerDispatcher, private readonly checkpoints: CheckpointStore) {}

  async start(options: DurableWorkerDispatchOptions): Promise<WorkerDispatchResult> {
    const dispatch = options.recoveryEvidence === undefined
      ? await this.dispatcher.start(options.prompt, options.worktree, options.checkpoint.workerRole ?? "primary")
      : await this.dispatcher.startRecovery(options.recoveryEvidence, options.prompt, options.worktree);
    const checkpoint = addWorkerEvidence(options.checkpoint, dispatch, options.runId, options.localModel);
    await this.checkpoints.save({ ...checkpoint, sessionId: dispatch.run.sessionId, pid: dispatch.run.pid ?? null, ...(dispatch.run.sessionId === null ? {} : { lifecycle: dispatch.run.resumable ? "RESUMABLE" as const : "RETIRED" as const }) });
    return dispatch;
  }
}
