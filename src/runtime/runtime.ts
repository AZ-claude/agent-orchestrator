import { CheckpointStore } from "../checkpoint/index.js";
import { relative, resolve } from "node:path";
import {
  assertExecutableRuntimeTarget,
  Checkpoint,
  ExecutableRuntimeTargetConfig,
  ExecutionState,
  ManifestTask,
  PermanentPilotTargetConfig,
  ProductionTargetConfig,
  RuntimeTargetConfig,
  TaskManifest,
  WorkerOutcome,
  WorkerRole,
} from "../config/index.js";
import { GitAdapter, GitSnapshot, MergeGateResult } from "../git/index.js";
import { GhClient, GitHubIssueProjector, IssueSnapshot, TASK_MARKER } from "../github/index.js";
import { ReviewCloseController, IndependentReviewer, ControllerResult, RecoveryReviewEvidence } from "../controller/index.js";
import { reconcile, ReconcileAction } from "../reconcile/index.js";
import { DeterministicScheduler, schedulerTasks } from "../scheduler/index.js";
import { MachineValidator, ReviewPacket } from "../validation/index.js";
import { DurableWorkerDispatchOptions, DurableWorkerResumeOptions, WorkerDispatchHandle, WorkerDispatchResult } from "../worker/index.js";

export interface RuntimeWorkerBoundary {
  readonly start: (options: DurableWorkerDispatchOptions) => Promise<WorkerDispatchResult>;
  readonly startDetached?: (options: DurableWorkerDispatchOptions) => Promise<WorkerDispatchHandle>;
  readonly resume: (options: DurableWorkerResumeOptions) => Promise<WorkerDispatchResult>;
  readonly resumeDetached?: (options: DurableWorkerResumeOptions) => Promise<WorkerDispatchHandle>;
  readonly retire: (pid?: number) => Promise<boolean>;
}

export interface RuntimeIssueBoundary {
  readonly verifyTarget?: () => Promise<void>;
  readonly readOpen: () => Promise<readonly IssueSnapshot[]>;
  readonly setState: (issueNumber: number, state: ExecutionState) => Promise<void>;
  readonly close: (issueNumber: number) => Promise<void>;
  readonly comment?: (issueNumber: number, body: string) => Promise<void>;
  readonly unlockDependents?: (taskId: string, manifest: TaskManifest) => Promise<void>;
}

export interface RuntimeCompositionDependencies {
  readonly target: RuntimeTargetConfig;
  readonly manifest: TaskManifest;
  readonly stateRoot: string;
  readonly issues: RuntimeIssueBoundary;
  readonly checkpoints?: CheckpointStore;
  readonly git?: GitAdapter;
  readonly workers: RuntimeWorkerBoundary;
  readonly reviewer: IndependentReviewer;
  readonly localModel?: string;
  readonly validator?: MachineValidator;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly sessionExists?: (sessionId: string) => Promise<boolean>;
  readonly now?: () => Date;
  readonly retryIntervalMs: number;
  readonly maxLunaWorkers?: number;
  /** Explicit durable approval evidence for tasks declaring a Human Gate. */
  readonly humanGateApproved?: (taskId: string) => boolean;
  readonly activeMergeBarrier?: () => boolean;
}

export interface RuntimePollResult {
  readonly kind: "idle" | "dispatched" | "advanced" | "watching" | "paused" | "blocked-human" | "completed";
  readonly taskId?: string;
  readonly action?: ReconcileAction["kind"];
  readonly controller?: ControllerResult;
}

export class RuntimeOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeOwnershipError";
  }
}

/**
 * Composition root for one explicitly selected runtime poll.
 * Every decision is rebuilt from checkpoints, Issue projections, and Git facts;
 * instance fields contain no task lifecycle state.
 */
export class RuntimeComposition {
  private readonly target: ExecutableRuntimeTargetConfig;
  private readonly checkpoints: CheckpointStore;
  private readonly git: GitAdapter;
  private readonly validator: MachineValidator;

  constructor(private readonly deps: RuntimeCompositionDependencies) {
    this.target = assertExecutableRuntimeTarget(deps.target);
    if (deps.manifest.handoff.targetRepo !== this.target.targetRepo) throw new Error("manifest target does not match runtime target");
    if (isWithinPath(deps.stateRoot, this.target.targetRepo)) throw new RuntimeOwnershipError("runtime state must be outside the disposable target");
    this.checkpoints = deps.checkpoints ?? new CheckpointStore(deps.stateRoot);
    this.git = deps.git ?? new GitAdapter();
    this.validator = deps.validator ?? new MachineValidator(this.git);
  }

  async poll(): Promise<RuntimePollResult> {
    if (this.deps.target.target === "production") await this.git.ensureProductionClone(this.target as ProductionTargetConfig, this.deps.stateRoot);
    if (this.deps.target.target === "pilot") await this.git.ensurePilotClone(this.target as PermanentPilotTargetConfig, this.deps.stateRoot);
    await this.deps.issues.verifyTarget?.();
    const issues = await this.deps.issues.readOpen();
    const checkpoints = await this.checkpoints.list();
    const issueByTask = indexTaskIssues(issues, this.deps.manifest);
    assertUniqueOwnership(checkpoints, issueByTask);
    let watchedTaskId: string | undefined;

    for (const checkpoint of checkpoints.sort((left, right) => left.taskId.localeCompare(right.taskId))) {
      const task = this.task(checkpoint.taskId);
      const issue = issueByTask.get(task.id);
      if (issue === undefined) continue;
      if (issue.state === "CLOSED" && checkpoint.lifecycle === "CLEANUP") return { kind: "completed", taskId: task.id, action: "skip-completed" };
      const currentState = checkpoint.executionState ?? issueState(issue) ?? "ready";
      if (currentState === "rework") {
        await this.resume(checkpoint, task, issue);
        return { kind: "advanced", taskId: task.id, action: "resume-luna" };
      }
      if (currentState === "worker-done") {
        const result = await this.processWorkerDone(checkpoint, task, issue);
        return { kind: result.status === "approved" ? "completed" : result.status === "blocked-human" ? "blocked-human" : "paused", taskId: task.id, controller: result };
      }
      if (currentState === "reviewing" && checkpoint.review?.result === "APPROVE" && checkpoint.reviewedHead !== undefined) {
        const result = await this.mergeApprovedCheckpoint(checkpoint, task, issue);
        return { kind: result.status === "approved" ? "completed" : "blocked-human", taskId: task.id, controller: result };
      }
      if (currentState === "paused") {
        const retryAt = checkpoint.retryAt === null ? null : Date.parse(checkpoint.retryAt);
        if (retryAt !== null && retryAt > (this.deps.now?.() ?? new Date()).getTime()) return { kind: "paused", taskId: task.id, action: "pause" };
        if (checkpoint.processOutcome === "lease-busy" || (checkpoint.processOutcome === "availability-limit" && checkpoint.sessionId === null)) {
          await this.retryFresh(checkpoint, task, issue);
          return { kind: "advanced", taskId: task.id, action: "pause" };
        }
        if (checkpoint.sessionId !== null) {
          await this.resume(checkpoint, task, issue);
          return { kind: "advanced", taskId: task.id, action: "resume-luna" };
        }
      }
      if (!["running", "reviewing", "paused"].includes(currentState)) continue;
      const action = await this.reconcileCheckpoint(checkpoint, issue, currentState);
      if (action.kind === "watch") {
        watchedTaskId = task.id;
        continue;
      }
      if (action.kind === "pause" || action.kind === "wait-local-lease") {
        await this.save({ ...checkpoint, executionState: "paused", retryAt: action.retryAt ?? this.retryAt() });
        await this.deps.issues.setState(issue.number, "paused");
        return { kind: "paused", taskId: task.id, action: action.kind };
      }
      if (action.kind === "validate") {
        const current = await this.requiredCheckpoint(checkpoint.taskId);
        const result = await this.processWorkerDone({ ...current, executionState: "worker-done" }, task, issue);
        return { kind: result.status === "approved" ? "completed" : "blocked-human", taskId: task.id, controller: result };
      }
      if (action.kind === "resume-luna") {
        await this.resume(checkpoint, task, issue);
        return { kind: "advanced", taskId: task.id, action: action.kind };
      }
      if (action.kind === "restart-luna") {
        await this.retryFresh(checkpoint, task, issue);
        return { kind: "advanced", taskId: task.id, action: action.kind };
      }
      if (action.kind === "resume-terra") {
        const current = await this.requiredCheckpoint(checkpoint.taskId);
        const result = await this.processWorkerDone({ ...current, executionState: "worker-done" }, task, issue);
        return { kind: result.status === "approved" ? "completed" : "blocked-human", taskId: task.id, controller: result };
      }
      if (action.kind === "cleanup-candidate") return { kind: "completed", taskId: task.id, action: action.kind };
      await this.block(checkpoint, issue, action.reason ?? "unsafe reconciliation");
      return { kind: "blocked-human", taskId: task.id, action: action.kind };
    }

    const closed = new Set([...issueByTask.entries()].filter(([, issue]) => issue.state === "CLOSED").map(([taskId]) => taskId));
    const open = new Set([...issueByTask.entries()].filter(([, issue]) => issue.state === "OPEN").map(([taskId]) => taskId));
    const states = new Map(checkpoints.map((checkpoint) => [checkpoint.taskId, checkpoint.executionState ?? "running" as ExecutionState]));
    const dependencyEvidence = new Set(this.deps.manifest.tasks.filter((task) => task.dependsOn.every((dependency) => closed.has(dependency))).map((task) => task.id));
    const humanGates = new Set(this.deps.manifest.tasks.filter((task) => task.humanGate && (this.deps.humanGateApproved?.(task.id) ?? false)).map((task) => task.id));
    const ready = new DeterministicScheduler().planDispatch({
      tasks: schedulerTasks(this.deps.manifest, states, closed, humanGates, open, dependencyEvidence),
      running: checkpoints.filter((checkpoint) => checkpoint.executionState === "running").map((checkpoint) => ({ taskId: checkpoint.taskId, parallel: this.task(checkpoint.taskId).parallel })),
      maxLunaWorkers: this.deps.maxLunaWorkers ?? 1,
      mergeBarrierActive: this.deps.activeMergeBarrier?.() ?? false,
    });
    const next = ready[0];
    if (next === undefined) return watchedTaskId === undefined ? { kind: "idle" } : { kind: "watching", taskId: watchedTaskId, action: "watch" };
    const issue = issueByTask.get(next.id);
    if (issue === undefined) return { kind: "idle" };
    await this.start(next, issue);
    return { kind: "dispatched", taskId: next.id };
  }

  private async start(task: ManifestTask, issue: IssueSnapshot): Promise<void> {
    const worktree = await this.git.prepareWorktree(this.target.targetRepo, task.id, this.deps.stateRoot, this.target.baseBranch);
    const existing = await this.checkpoints.load(task.id);
    if (existing !== null) throw new RuntimeOwnershipError(`task ${task.id} already has a checkpoint`);
    const checkpoint: Checkpoint = {
      issueNumber: issue.number,
      taskId: task.id,
      phase: "luna",
      attempt: 1,
      sessionId: null,
      branch: worktree.branch,
      worktree: worktree.path,
      pid: null,
      lastHead: null,
      retryAt: null,
      executionState: "running",
      workerRole: "primary",
      lifecycle: "ACTIVE",
    };
    await this.save(checkpoint);
    await this.deps.issues.setState(issue.number, "running");
    const options = { checkpoint, prompt: promptFor(task), worktree: worktree.path, runId: `${task.id}-1`, ...(this.deps.localModel === undefined ? {} : { localModel: this.deps.localModel }) };
    if (this.deps.workers.startDetached !== undefined) {
      const dispatch = await this.deps.workers.startDetached(options);
      void dispatch.completion.then((result) => this.recordWorkerResult(checkpoint, result.run.outcome, result.run.sessionId, result.run.pid, worktree.path)).catch((error: unknown) => this.block(checkpoint, issue, `worker completion failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const dispatch = await this.deps.workers.start(options);
    await this.recordWorkerResult(checkpoint, dispatch.run.outcome, dispatch.run.sessionId, dispatch.run.pid, worktree.path);
  }

  private async resume(checkpoint: Checkpoint, task: ManifestTask, issue: IssueSnapshot): Promise<void> {
    if (checkpoint.sessionId === null) {
      await this.block(checkpoint, issue, "running checkpoint has no resumable session");
      return;
    }
    const running = { ...checkpoint, executionState: "running" as const, pid: null, retryAt: null };
    await this.save(running);
    await this.deps.issues.setState(issue.number, "running");
    const options: DurableWorkerResumeOptions = { checkpoint: running, sessionId: checkpoint.sessionId, prompt: promptFor(task), worktree: checkpoint.worktree, runId: checkpoint.runId ?? `${task.id}-${checkpoint.attempt}`, ...(checkpoint.localModel === undefined ? {} : { localModel: checkpoint.localModel }) };
    if (this.deps.workers.resumeDetached !== undefined) {
      const dispatch = await this.deps.workers.resumeDetached(options);
      void dispatch.completion.then((result) => this.recordWorkerResult(running, result.run.outcome, result.run.sessionId, result.run.pid, checkpoint.worktree)).catch((error: unknown) => this.block(running, issue, `worker completion failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const dispatch = await this.deps.workers.resume(options);
    await this.recordWorkerResult(running, dispatch.run.outcome, dispatch.run.sessionId, dispatch.run.pid, checkpoint.worktree);
  }

  private async retryFresh(checkpoint: Checkpoint, task: ManifestTask, issue: IssueSnapshot): Promise<void> {
    const running = { ...checkpoint, executionState: "running" as const, pid: null, retryAt: null };
    await this.save(running);
    await this.deps.issues.setState(issue.number, "running");
    const options = { checkpoint: running, prompt: promptFor(task), worktree: running.worktree, runId: `${task.id}-${running.attempt}`, ...(running.localModel === undefined ? {} : { localModel: running.localModel }) };
    if (this.deps.workers.startDetached !== undefined) {
      const dispatch = await this.deps.workers.startDetached(options);
      void dispatch.completion.then((result) => this.recordWorkerResult(running, result.run.outcome, result.run.sessionId, result.run.pid, running.worktree)).catch((error: unknown) => this.block(running, issue, `worker completion failed: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const dispatch = await this.deps.workers.start(options);
    await this.recordWorkerResult(running, dispatch.run.outcome, dispatch.run.sessionId, dispatch.run.pid, running.worktree);
  }

  private async recordWorkerResult(checkpoint: Checkpoint, outcome: WorkerOutcome, sessionId: string | null, pid: number | undefined, worktree: string): Promise<void> {
    const snapshot = await safeSnapshot(this.git, worktree, `origin/${this.target.baseBranch}`);
    const persisted = await this.requiredCheckpoint(checkpoint.taskId);
    const nextState: ExecutionState = outcome === "success" ? "worker-done" : outcome === "availability-limit" || outcome === "lease-busy" ? "paused" : outcome === "crash" && sessionId !== null ? "running" : "blocked-human";
    const issue = await this.issueFor(checkpoint.taskId);
    await this.save({ ...persisted, sessionId, pid: nextState === "running" ? pid ?? null : null, lastHead: snapshot.head || persisted.lastHead, executionState: nextState, retryAt: nextState === "paused" ? this.retryAt() : null, lifecycle: sessionId === null ? "RETIRED" : "RESUMABLE", processOutcome: outcome });
    if (issue !== undefined) await this.deps.issues.setState(issue.number, nextState);
  }

  private async processWorkerDone(checkpoint: Checkpoint, task: ManifestTask, issue: IssueSnapshot): Promise<ControllerResult> {
    await this.save({ ...checkpoint, executionState: "worker-done", pid: null });
    const controller = new ReviewCloseController({
      validate: async () => this.validate(checkpoint, task),
      reviewer: this.deps.reviewer,
      mergeReviewed: async (packet) => this.merge(checkpoint, packet),
      resumeWorker: async (_provider, reason) => this.resumeForRework(checkpoint, task, issue, reason),
      startRecovery: async (evidence) => this.startRecovery(checkpoint, task, issue, evidence),
      providerForRole: (role) => role === "primary" ? checkpoint.configuredPrimary ?? checkpoint.workerProvider ?? "cloud" : checkpoint.configuredRecovery ?? checkpoint.workerProvider ?? "cloud",
      retirePrimary: async () => { await this.deps.workers.retire(checkpoint.pid ?? undefined); },
      setState: async (state) => { await this.save({ ...(await this.requiredCheckpoint(checkpoint.taskId)), executionState: state }); await this.deps.issues.setState(issue.number, state); },
      closeIssue: async () => { await this.deps.issues.close(issue.number); },
      unlockDependents: async () => { await this.deps.issues.unlockDependents?.(task.id, this.deps.manifest); },
      cleanup: async (role) => { await this.cleanup(checkpoint.taskId, role); },
      recordReview: async (role, result) => { await this.recordReview(checkpoint.taskId, role, result); },
      onPlanConflict: async (claim) => {
        const current = await this.requiredCheckpoint(checkpoint.taskId);
        await this.save({ ...current, planConflict: claim, executionState: "paused", retryAt: null });
        await this.deps.issues.comment?.(issue.number, `PLAN_CONFLICT: ${claim.taskId}`);
      },
    });
    return controller.processWorkerDone();
  }

  private async mergeApprovedCheckpoint(checkpoint: Checkpoint, task: ManifestTask, issue: IssueSnapshot): Promise<ControllerResult> {
    const packet = await this.validate(checkpoint, task);
    if (packet.head !== checkpoint.reviewedHead) {
      await this.block(checkpoint, issue, "reviewed HEAD changed before restart merge");
      return { status: "blocked-human", reviewRounds: checkpoint.review?.cycle ?? 1, packet, workerRole: checkpoint.workerRole ?? "primary", recoveryUsed: false, blockedReason: "MERGE_GATE_FAILED" };
    }
    const merged = await this.merge(checkpoint, packet);
    if (!merged.pass) {
      await this.block(checkpoint, issue, (merged.failedGates ?? []).join(", ") || "deterministic merge gate failed");
      return { status: "blocked-human", reviewRounds: checkpoint.review?.cycle ?? 1, packet, workerRole: checkpoint.workerRole ?? "primary", recoveryUsed: false, failedGates: merged.failedGates, blockedReason: "MERGE_GATE_FAILED" };
    }
    await this.deps.issues.close(issue.number);
    await this.cleanup(checkpoint.taskId, checkpoint.workerRole ?? "primary");
    return { status: "approved", reviewRounds: checkpoint.review?.cycle ?? 1, packet, workerRole: checkpoint.workerRole ?? "primary", recoveryUsed: false };
  }

  private async validate(checkpoint: Checkpoint, task: ManifestTask): Promise<ReviewPacket> {
    const issues = indexTaskIssues(await this.deps.issues.readOpen(), this.deps.manifest);
    const dependenciesPass = task.dependsOn.every((dependency) => issues.get(dependency)?.state === "CLOSED");
    const packet = await this.validator.validate(task, { worktree: checkpoint.worktree, repo: this.target.targetRepo, baseRef: `origin/${this.target.baseBranch}`, remoteBranch: checkpoint.branch, dependenciesPass, acceptance: task.completion ?? task.title, expectedBranch: checkpoint.branch, expectedWorktree: checkpoint.worktree, ...(checkpoint.review?.findingSignature === undefined ? {} : { previousRework: checkpoint.review.findingSignature }) });
    const current = await this.requiredCheckpoint(checkpoint.taskId);
    return { ...packet, ...(current.workerRole === undefined ? {} : { workerRole: current.workerRole }), ...(current.workerProvider === undefined ? {} : { workerProvider: current.workerProvider }), ...(current.workerAdapter === undefined ? {} : { workerAdapter: current.workerAdapter }), ...(current.localModel === undefined ? {} : { localModel: current.localModel }), ...(current.processOutcome === undefined || current.processOutcome === "lease-busy" ? {} : { processOutcome: current.processOutcome }) };
  }

  private async merge(checkpoint: Checkpoint, packet: ReviewPacket): Promise<MergeGateResult> {
    const current = await this.requiredCheckpoint(checkpoint.taskId);
    await this.save({ ...current, executionState: "reviewing", reviewedHead: packet.head, review: { result: "APPROVE", cycle: Math.max(1, current.review?.cycle ?? 1) } });
    const task = this.task(checkpoint.taskId);
    return this.git.mergeReviewedBranch({ repo: this.target.targetRepo, baseBranch: this.target.baseBranch, sourceBranch: checkpoint.branch, sourceWorktree: checkpoint.worktree, facts: { requiredTestsPass: packet.test.pass, machineValidationPass: this.validator.isPass(packet), scopePass: packet.scope === "PASS", unexpectedDiffPass: packet.unexpectedFiles.length === 0, cleanWorktree: packet.clean, pushedBranch: packet.pushed, dependencyBasePass: packet.dependencies === "PASS" && packet.baseAncestor === "PASS", reviewedHead: packet.head, currentHead: packet.head, unresolvedHumanGate: task.humanGate && !(this.deps.humanGateApproved?.(task.id) ?? false), activeMergeBarrier: this.deps.activeMergeBarrier?.() ?? false } });
  }

  private async resumeForRework(checkpoint: Checkpoint, task: ManifestTask, issue: IssueSnapshot, reason: string): Promise<void> {
    const current = await this.requiredCheckpoint(checkpoint.taskId);
    if (current.sessionId === null) throw new RuntimeOwnershipError("cannot rework without a resumable session");
    await this.resume(current, task, issue);
    await this.deps.issues.comment?.(issue.number, `REWORK resumed: ${reason}`);
  }

  private async startRecovery(checkpoint: Checkpoint, task: ManifestTask, issue: IssueSnapshot, evidence: RecoveryReviewEvidence): Promise<void> {
    const current = await this.requiredCheckpoint(checkpoint.taskId);
    const { review: _review, reviewedHead: _reviewedHead, ...withoutApproval } = current;
    const recovery: Checkpoint = { ...withoutApproval, attempt: current.attempt + 1, workerRole: "recovery", executionState: "running", recovery: { takeoverCount: (current.recovery?.takeoverCount ?? 0) + 1, status: "active", attemptedFixSummary: evidence.attemptedFixSummary }, pid: null };
    await this.save(recovery);
    await this.deps.issues.setState(issue.number, "running");
    const dispatch = await this.deps.workers.start({ checkpoint: recovery, prompt: promptFor(task), worktree: recovery.worktree, runId: `${task.id}-${recovery.attempt}`, ...(recovery.localModel === undefined ? {} : { localModel: recovery.localModel }), recoveryEvidence: evidence });
    await this.recordWorkerResult(recovery, dispatch.run.outcome, dispatch.run.sessionId, dispatch.run.pid, recovery.worktree);
  }

  private async recordReview(taskId: string, role: WorkerRole, result: Parameters<NonNullable<import("../controller/index.js").ControllerDependencies["recordReview"]>>[1]): Promise<void> {
    const checkpoint = await this.requiredCheckpoint(taskId);
    if (result === "APPROVE") {
      await this.save({ ...checkpoint, review: { result: "APPROVE", cycle: (checkpoint.review?.cycle ?? 0) + 1 }, workerRole: role });
      return;
    }
    if (typeof result !== "object") return;
    if (result.result === "REWORK") {
      await this.save({ ...checkpoint, review: { result: "REWORK", cycle: (checkpoint.review?.cycle ?? 0) + 1, findingSignature: result.reason }, workerRole: role });
    }
  }

  private async reconcileCheckpoint(checkpoint: Checkpoint, issue: IssueSnapshot, state: ExecutionState): Promise<ReconcileAction> {
    const processAlive = checkpoint.pid !== null && (this.deps.isProcessAlive?.(checkpoint.pid) ?? isProcessAlive(checkpoint.pid));
    let pushedHead = false;
    let workerHeadValid: boolean | undefined;
    let safeFreshRecovery: boolean | undefined;
    if (!processAlive) {
      const observed = await safeObserveWorker(this.git, this.target.targetRepo, checkpoint.worktree, `origin/${this.target.baseBranch}`, checkpoint.branch);
      if (observed !== undefined) {
        workerHeadValid = observed.valid;
        pushedHead = observed.pushed;
        safeFreshRecovery = observed.valid && !observed.pushed && (observed.remoteHead === null || observed.remoteHead === observed.baseHead);
        if (observed.pushed && observed.currentHead !== checkpoint.lastHead) {
          const current = await this.requiredCheckpoint(checkpoint.taskId);
          await this.save({ ...current, lastHead: observed.currentHead });
        }
      }
    }
    const sessionExists = checkpoint.sessionId !== null && (await (this.deps.sessionExists?.(checkpoint.sessionId) ?? Promise.resolve(true)));
    return reconcile({ checkpoint, issueState: state, processAlive, pushedHead, sessionExists, rateLimited: false, now: this.deps.now?.() ?? new Date(), ...(workerHeadValid === undefined ? {} : { workerHeadValid }), ...(safeFreshRecovery === undefined ? {} : { safeFreshRecovery }) }, this.deps.retryIntervalMs);
  }

  private async cleanup(taskId: string, role: WorkerRole): Promise<void> {
    const checkpoint = await this.requiredCheckpoint(taskId);
    await this.save({ ...checkpoint, lifecycle: "CLEANUP", executionState: "reviewing", pid: null, workerRole: role });
    await this.git.removeWorktree(this.target.targetRepo, checkpoint.worktree);
  }

  private async block(checkpoint: Checkpoint, issue: IssueSnapshot, reason: string): Promise<void> {
    await this.save({ ...checkpoint, executionState: "blocked-human", pid: null, retryAt: null });
    await this.deps.issues.setState(issue.number, "blocked-human");
    await this.deps.issues.comment?.(issue.number, `Blocked human: ${reason}`);
  }

  private async save(checkpoint: Checkpoint): Promise<void> { await this.checkpoints.save(checkpoint); }

  private async requiredCheckpoint(taskId: string): Promise<Checkpoint> {
    const checkpoint = await this.checkpoints.load(taskId);
    if (checkpoint === null) throw new RuntimeOwnershipError(`missing checkpoint for ${taskId}`);
    return checkpoint;
  }

  private async issueFor(taskId: string): Promise<IssueSnapshot | undefined> {
    return indexTaskIssues(await this.deps.issues.readOpen(), this.deps.manifest).get(taskId);
  }

  private task(taskId: string): ManifestTask {
    const task = this.deps.manifest.tasks.find((item) => item.id === taskId);
    if (task === undefined) throw new RuntimeOwnershipError(`checkpoint references unknown task ${taskId}`);
    return task;
  }

  private retryAt(): string { return new Date((this.deps.now?.() ?? new Date()).getTime() + this.deps.retryIntervalMs).toISOString(); }
}

export function createRuntimeIssueBoundary(client: GhClient, targetRepo?: string): RuntimeIssueBoundary {
  const projector = new GitHubIssueProjector(client);
  return {
    ...(targetRepo !== undefined && "verifyTarget" in client && typeof client.verifyTarget === "function" ? { verifyTarget: () => (client as import("../github/index.js").TargetVerifiedGhClient).verifyTarget(targetRepo) } : {}),
    readOpen: () => projector.readOpen(),
    setState: (issueNumber, state) => projector.setState(issueNumber, state),
    close: (issueNumber) => projector.close(issueNumber),
    unlockDependents: async (taskId, manifest) => {
      const issues = indexTaskIssues(await projector.readOpen(), manifest);
      const dependency = issues.get(taskId);
      if (dependency === undefined) return;
      for (const task of manifest.tasks.filter((item) => item.dependsOn.includes(taskId))) {
        const issue = issues.get(task.id);
        if (issue?.blockedBy.includes(dependency.number)) await projector.removeBlockedBy(issue.number, dependency.number);
      }
    },
  };
}

function promptFor(task: ManifestTask): string {
  return [`Implement exactly ${task.id}: ${task.title}.`, "Work only in the assigned worktree and allowed paths.", "Run the task verification command, then commit the change and push the assigned branch. Do not merge main or operate production resources."].join(" ");
}

function indexTaskIssues(issues: readonly IssueSnapshot[], manifest: TaskManifest): ReadonlyMap<string, IssueSnapshot> {
  const result = new Map<string, IssueSnapshot>();
  for (const task of manifest.tasks) {
    const matches = issues.filter((issue) => issue.body.includes(TASK_MARKER(task.id)));
    if (matches.length > 1) throw new RuntimeOwnershipError(`task ${task.id} has duplicate Issue ownership`);
    const issue = matches[0];
    if (issue !== undefined) result.set(task.id, issue);
  }
  return result;
}

function assertUniqueOwnership(checkpoints: readonly Checkpoint[], issues: ReadonlyMap<string, IssueSnapshot>): void {
  const branches = new Map<string, string>();
  const worktrees = new Map<string, string>();
  for (const checkpoint of checkpoints) {
    const oldBranch = branches.get(checkpoint.branch);
    if (oldBranch !== undefined && oldBranch !== checkpoint.taskId) throw new RuntimeOwnershipError(`branch ${checkpoint.branch} is owned by ${oldBranch} and ${checkpoint.taskId}`);
    branches.set(checkpoint.branch, checkpoint.taskId);
    const oldWorktree = worktrees.get(checkpoint.worktree);
    if (oldWorktree !== undefined && oldWorktree !== checkpoint.taskId) throw new RuntimeOwnershipError(`worktree ${checkpoint.worktree} is owned by ${oldWorktree} and ${checkpoint.taskId}`);
    worktrees.set(checkpoint.worktree, checkpoint.taskId);
  }
  for (const [taskId, issue] of issues) {
    if (issue.number < 1) throw new RuntimeOwnershipError(`invalid Issue ownership for ${taskId}`);
  }
}

function issueState(issue: IssueSnapshot): ExecutionState | undefined {
  if (issue.state === "CLOSED") return undefined;
  const labels = issue.labels.filter((label) => label.startsWith("ao:state:"));
  if (labels.length !== 1) return undefined;
  const candidate = labels[0]?.slice(9);
  return candidate !== undefined && ["ready", "running", "paused", "worker-done", "reviewing", "rework", "blocked-human"].includes(candidate) ? candidate as ExecutionState : undefined;
}

async function safeSnapshot(git: GitAdapter, worktree: string, baseRef: string): Promise<GitSnapshot> {
  try { return await git.snapshot(worktree, baseRef); } catch { return { branch: "", head: "", clean: false, changedFiles: [] }; }
}

async function safeObserveWorker(git: GitAdapter, repo: string, worktree: string, baseRef: string, branch: string): Promise<Awaited<ReturnType<GitAdapter["observeWorker"]>> | undefined> {
  try { return await git.observeWorker(repo, worktree, baseRef, branch); } catch { return undefined; }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isWithinPath(candidate: string, parent: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && pathFromParent !== "");
}
