import { WorkerConfig, WorkerMode, WorkerProvider, WorkerRole } from "../config/index.js";
import { ImplementationWorkerAdapter, WorkerProcessHandle, WorkerProcessStarted, WorkerRecoveryEvidence, WorkerRunResult } from "./worker.js";
import type { Checkpoint } from "../config/index.js";

export interface ProviderFallbackFact {
  readonly from: "cloud";
  readonly to: "local";
  readonly reason: "RATE_LIMIT" | "USAGE_LIMIT" | "QUOTA_LIMIT";
  readonly latched: true;
}

export interface WorkerRunRouting {
  readonly mode: WorkerMode;
  readonly configuredPrimary: WorkerProvider;
  readonly configuredRecovery: WorkerProvider;
  readonly latchedProvider: WorkerProvider | null;
  readonly fallback?: ProviderFallbackFact;
}

export interface WorkerDispatchResult {
  readonly run: WorkerRunResult;
  readonly routing: WorkerRunRouting;
}
export interface WorkerDispatchHandle {
  readonly started: WorkerProcessStarted;
  readonly routing: WorkerRunRouting;
  readonly completion: Promise<WorkerDispatchResult>;
}
export type LocalPreflightGate = () => Promise<boolean>;

const CLOUD_DEFAULTS: WorkerConfig = { mode: "cloud", primary: "cloud", recovery: "cloud" };

/** A per-run, deterministic provider choice. It has no semantic task router. */
export class WorkerRunRouter {
  private readonly config: WorkerConfig;
  private latchedProvider: WorkerProvider | null = null;
  private fallback: ProviderFallbackFact | undefined;

  constructor(config?: WorkerConfig) {
    this.config = config ?? CLOUD_DEFAULTS;
  }

  get state(): WorkerRunRouting {
    return {
      mode: this.config.mode,
      configuredPrimary: this.config.primary,
      configuredRecovery: this.config.recovery,
      latchedProvider: this.latchedProvider,
      ...(this.fallback === undefined ? {} : { fallback: this.fallback }),
    };
  }

  providerFor(role: WorkerRole): WorkerProvider {
    // Recovery is an explicitly configured policy. A primary fallback must
    // never silently turn a recovery run into a different provider.
    if (role === "recovery") return this.config.recovery;
    if (this.latchedProvider !== null) return this.latchedProvider;
    if (this.config.mode === "local") return "local";
    return role === "primary" ? this.config.primary : this.config.recovery;
  }

  /** Restore durable provider facts before a fresh router makes a decision. */
  restore(checkpoint: Pick<Checkpoint, "workerProvider" | "providerFallback">): void {
    if (checkpoint.workerProvider !== undefined) this.latchedProvider = checkpoint.workerProvider;
    if (checkpoint.providerFallback !== undefined) this.fallback = checkpoint.providerFallback;
  }

  observeLimit(provider: WorkerProvider, reason: ProviderFallbackFact["reason"]): ProviderFallbackFact | undefined {
    if (this.config.mode !== "auto" || provider !== "cloud" || this.latchedProvider === "local") return undefined;
    this.latchedProvider = "local";
    this.fallback = { from: "cloud", to: "local", reason, latched: true };
    return this.fallback;
  }
}

export class WorkerDispatcher {
  constructor(
    private readonly router: WorkerRunRouter,
    private readonly adapters: Readonly<{ cloud: ImplementationWorkerAdapter; local: ImplementationWorkerAdapter }>,
    private readonly localPreflight?: LocalPreflightGate,
  ) {}

  async start(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerDispatchResult> {
    const provider = this.router.providerFor(role);
    const first = await this.startWithPreflight(provider, prompt, worktree, role);
    const fallback = first.availabilityReason === undefined
      ? undefined
      : this.router.observeLimit(first.provider, first.availabilityReason);
    if (first.provider === "cloud" && first.outcome === "availability-limit" && fallback === undefined && this.router.state.mode === "auto") {
      throw new Error("cloud availability-limit is missing an explicit RATE_LIMIT/USAGE_LIMIT/QUOTA_LIMIT reason");
    }
    if (fallback !== undefined) {
      const local = await this.startWithPreflight("local", prompt, worktree, role);
      return { run: local, routing: this.router.state };
    }
    return { run: first, routing: this.router.state };
  }

  async startDetached(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerDispatchHandle> {
    const provider = this.router.providerFor(role);
    const first = await this.startDetachedWithPreflight(provider, prompt, worktree, role);
    return {
      started: first.started,
      routing: this.router.state,
      completion: first.completion.then(async (run) => {
        const fallback = run.availabilityReason === undefined
          ? undefined
          : this.router.observeLimit(run.provider, run.availabilityReason);
        if (run.provider === "cloud" && run.outcome === "availability-limit" && fallback === undefined && this.router.state.mode === "auto") {
          throw new Error("cloud availability-limit is missing an explicit RATE_LIMIT/USAGE_LIMIT/QUOTA_LIMIT reason");
        }
        if (fallback !== undefined) {
          const local = await this.startDetachedWithPreflight("local", prompt, worktree, role);
          return local.completion.then((localRun) => ({ run: localRun, routing: this.router.state }));
        }
        return { run, routing: this.router.state };
      }).then((result) => result),
    };
  }

  async startRecovery(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerDispatchResult> {
    const provider = this.router.providerFor("recovery");
    const preflightFailure = await this.preflightFailure(provider, "recovery");
    if (preflightFailure !== undefined) return { run: preflightFailure, routing: this.router.state };
    const run = await this.adapter(provider).startRecovery(evidence, prompt, worktree);
    return { run, routing: this.router.state };
  }

  async resume(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerDispatchResult> {
    const provider = this.router.providerFor(role);
    const preflightFailure = await this.preflightFailure(provider, role);
    if (preflightFailure !== undefined) return { run: preflightFailure, routing: this.router.state };
    const run = await this.adapter(provider).resume(sessionId, prompt, worktree, role);
    return { run, routing: this.router.state };
  }

  async resumeDetached(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerDispatchHandle> {
    const provider = this.router.providerFor(role);
    const preflightFailure = await this.preflightFailure(provider, role);
    if (preflightFailure !== undefined) return completedDispatchHandle(preflightFailure, this.router.state);
    const adapter = this.adapter(provider);
    if (adapter.resumeDetached !== undefined) {
      const handle = await adapter.resumeDetached(sessionId, prompt, worktree, role);
      return { started: handle.started, routing: this.router.state, completion: handle.completion.then((run) => ({ run, routing: this.router.state })) };
    }
    return backgroundFallback(adapter.resume(sessionId, prompt, worktree, role), provider, role, false, this.router.state);
  }

  async startRecoveryDetached(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerDispatchHandle> {
    const provider = this.router.providerFor("recovery");
    const preflightFailure = await this.preflightFailure(provider, "recovery");
    if (preflightFailure !== undefined) return completedDispatchHandle(preflightFailure, this.router.state);
    const adapter = this.adapter(provider);
    if (adapter.startRecoveryDetached !== undefined) {
      const handle = await adapter.startRecoveryDetached(evidence, prompt, worktree);
      return { started: handle.started, routing: this.router.state, completion: handle.completion.then((run) => ({ run, routing: this.router.state })) };
    }
    return backgroundFallback(adapter.startRecovery(evidence, prompt, worktree), provider, "recovery", true, this.router.state);
  }

  async retire(pid?: number): Promise<boolean> {
    if (pid === undefined) return false;
    const provider = this.router.providerFor("primary");
    return this.adapter(provider).retire(pid);
  }

  restore(checkpoint: Pick<Checkpoint, "workerProvider" | "providerFallback">): void {
    this.router.restore(checkpoint);
  }

  private adapter(provider: WorkerProvider): ImplementationWorkerAdapter {
    const adapter = this.adapters[provider];
    if (adapter.provider !== provider) throw new Error(`worker adapter/provider mismatch: ${provider}`);
    return adapter;
  }

  private async startWithPreflight(provider: WorkerProvider, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    const preflightFailure = await this.preflightFailure(provider, role);
    if (preflightFailure !== undefined) return preflightFailure;
    return this.adapter(provider).start(prompt, worktree, role);
  }

  private async startDetachedWithPreflight(provider: WorkerProvider, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerProcessHandle> {
    const preflightFailure = await this.preflightFailure(provider, role);
    if (preflightFailure !== undefined) return completedProcessHandle(preflightFailure);
    const adapter = this.adapter(provider);
    if (adapter.startDetached !== undefined) return adapter.startDetached(prompt, worktree, role);
    return backgroundProcessFallback(adapter.start(prompt, worktree, role), provider, role, true);
  }

  private async preflightFailure(provider: WorkerProvider, role: WorkerRole): Promise<WorkerRunResult | undefined> {
    if (provider !== "local") return undefined;
    if (this.localPreflight !== undefined && await this.localPreflight()) return undefined;
    return { provider: "local", adapter: "opencode", role, sessionId: null, pid: undefined, outcome: "failed", exitCode: null, stderr: [], logPath: "", fresh: true, resumable: false };
  }
}

function completedProcessHandle(run: WorkerRunResult): WorkerProcessHandle {
  return {
    started: { provider: run.provider, adapter: run.adapter, role: run.role, sessionId: null, pid: run.pid, logPath: run.logPath, fresh: run.fresh, resumable: false, ...(run.lease === undefined ? {} : { lease: run.lease }) },
    completion: Promise.resolve(run),
  };
}

function completedDispatchHandle(run: WorkerRunResult, routing: WorkerRunRouting): WorkerDispatchHandle {
  return {
    started: { provider: run.provider, adapter: run.adapter, role: run.role, sessionId: null, pid: run.pid, logPath: run.logPath, fresh: run.fresh, resumable: false, ...(run.lease === undefined ? {} : { lease: run.lease }) },
    routing,
    completion: Promise.resolve({ run, routing }),
  };
}

function backgroundProcessFallback(completion: Promise<WorkerRunResult>, provider: WorkerProvider, role: WorkerRole, fresh: boolean): WorkerProcessHandle {
  return {
    started: { provider, adapter: provider === "cloud" ? "codex/luna" : "opencode", role, sessionId: null, pid: undefined, logPath: "", fresh, resumable: false },
    completion,
  };
}

function backgroundFallback(completion: Promise<WorkerRunResult>, provider: WorkerProvider, role: WorkerRole, fresh: boolean, routing: WorkerRunRouting): WorkerDispatchHandle {
  return {
    started: { provider, adapter: provider === "cloud" ? "codex/luna" : "opencode", role, sessionId: null, pid: undefined, logPath: "", fresh, resumable: false },
    routing,
    completion: completion.then((run) => ({ run, routing })),
  };
}
