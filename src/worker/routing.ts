import { WorkerConfig, WorkerMode, WorkerProvider, WorkerRole } from "../config/index.js";
import { ImplementationWorkerAdapter, WorkerRecoveryEvidence, WorkerRunResult } from "./worker.js";

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
    if (this.latchedProvider !== null) return this.latchedProvider;
    if (this.config.mode === "local") return "local";
    return role === "primary" ? this.config.primary : this.config.recovery;
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

  private async preflightFailure(provider: WorkerProvider, role: WorkerRole): Promise<WorkerRunResult | undefined> {
    if (provider !== "local") return undefined;
    if (this.localPreflight !== undefined && await this.localPreflight()) return undefined;
    return { provider: "local", adapter: "opencode", role, sessionId: null, pid: undefined, outcome: "failed", exitCode: null, stderr: [], logPath: "", fresh: true, resumable: false };
  }
}
