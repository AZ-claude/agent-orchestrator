import { Checkpoint } from "../config/index.js";
import { CheckpointStore } from "../checkpoint/index.js";
import { addWorkerEvidence } from "./evidence.js";
import { WorkerDispatcher, WorkerDispatchHandle, WorkerDispatchResult } from "./routing.js";
import { WorkerRecoveryEvidence } from "./worker.js";

export interface DurableWorkerDispatchOptions {
  readonly checkpoint: Checkpoint;
  readonly prompt: string;
  readonly worktree: string;
  readonly runId: string;
  readonly localModel?: string;
  readonly recoveryEvidence?: WorkerRecoveryEvidence;
}

export interface DurableWorkerResumeOptions extends DurableWorkerDispatchOptions {
  readonly sessionId: string;
}

/** Dispatches through the router and atomically records only restart-safe facts. */
export class DurableWorkerRuntime {
  constructor(private readonly dispatcher: WorkerDispatcher, private readonly checkpoints: CheckpointStore) {}

  async start(options: DurableWorkerDispatchOptions): Promise<WorkerDispatchResult> {
    this.dispatcher.restore(options.checkpoint);
    const dispatch = options.recoveryEvidence === undefined
      ? await this.dispatcher.start(options.prompt, options.worktree, options.checkpoint.workerRole ?? "primary")
      : await this.dispatcher.startRecovery(options.recoveryEvidence, options.prompt, options.worktree);
    return this.persist(options.checkpoint, dispatch, options.runId, options.localModel);
  }

  async resume(options: DurableWorkerResumeOptions): Promise<WorkerDispatchResult> {
    this.dispatcher.restore(options.checkpoint);
    const dispatch = await this.dispatcher.resume(options.sessionId, options.prompt, options.worktree, options.checkpoint.workerRole ?? "primary");
    return this.persist(options.checkpoint, dispatch, options.runId, options.localModel);
  }

  async startDetached(options: DurableWorkerDispatchOptions): Promise<WorkerDispatchHandle> {
    this.dispatcher.restore(options.checkpoint);
    const dispatch = options.recoveryEvidence === undefined
      ? await this.dispatcher.startDetached(options.prompt, options.worktree, options.checkpoint.workerRole ?? "primary")
      : await this.dispatcher.startRecoveryDetached(options.recoveryEvidence, options.prompt, options.worktree);
    await this.persistStarted(options.checkpoint, dispatch, options.runId, options.localModel);
    return {
      ...dispatch,
      completion: dispatch.completion.then((result) => this.persist(options.checkpoint, result, options.runId, options.localModel)),
    };
  }

  async resumeDetached(options: DurableWorkerResumeOptions): Promise<WorkerDispatchHandle> {
    this.dispatcher.restore(options.checkpoint);
    const dispatch = await this.dispatcher.resumeDetached(options.sessionId, options.prompt, options.worktree, options.checkpoint.workerRole ?? "primary");
    await this.persistStarted(options.checkpoint, dispatch, options.runId, options.localModel);
    return {
      ...dispatch,
      completion: dispatch.completion.then((result) => this.persist(options.checkpoint, result, options.runId, options.localModel)),
    };
  }

  async retire(pid?: number): Promise<boolean> {
    return this.dispatcher.retire(pid);
  }

  private async persistStarted(checkpoint: Checkpoint, dispatch: WorkerDispatchHandle, runId: string, localModel?: string): Promise<void> {
    const current = await this.checkpoints.load(checkpoint.taskId) ?? checkpoint;
    await this.checkpoints.save({
      ...current,
      issueNumber: checkpoint.issueNumber,
      taskId: checkpoint.taskId,
      phase: "luna",
      sessionId: dispatch.started.sessionId,
      pid: dispatch.started.pid ?? null,
      runId,
      workerRole: dispatch.started.role,
      workerProvider: dispatch.started.provider,
      workerAdapter: dispatch.started.adapter,
      workerMode: dispatch.routing.mode,
      configuredPrimary: dispatch.routing.configuredPrimary,
      configuredRecovery: dispatch.routing.configuredRecovery,
      ...(localModel === undefined ? {} : { localModel }),
      ...(dispatch.started.lease === undefined ? {} : { localLease: dispatch.started.lease }),
      lifecycle: "ACTIVE",
      executionState: "running",
      retryAt: null,
    });
  }

  private async persist(checkpoint: Checkpoint, dispatch: WorkerDispatchResult, runId: string, localModel?: string): Promise<WorkerDispatchResult> {
    const enriched = addWorkerEvidence(checkpoint, dispatch, runId, localModel);
    await this.checkpoints.save({ ...enriched, sessionId: dispatch.run.sessionId, pid: dispatch.run.pid ?? null, ...(dispatch.run.sessionId === null ? {} : { lifecycle: dispatch.run.resumable ? "RESUMABLE" as const : "RETIRED" as const }) });
    return dispatch;
  }
}
