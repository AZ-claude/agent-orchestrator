import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { AO_LOCAL_MODEL, REQUIRED_LOCAL_CONTEXT, WorkerRole } from "../config/index.js";
import { OpenCodeInvocation, OpenCodeProcess, OpenCodeOutcome, AvailabilityLimitReason, observeOpenCodeOutput, spawnOpenCode } from "./lifecycle.js";
import { LeaseEvidence, LocalInferenceLease } from "./lease.js";
import { ImplementationWorkerAdapter, WorkerProcessHandle, WorkerRecoveryEvidence, WorkerRunResult } from "../worker/index.js";

export type OpenCodeProcessFactory = (invocation: OpenCodeInvocation, cwd: string) => OpenCodeProcess;
export interface OpenCodeRunnerOptions {
  readonly executable?: string;
  readonly model: string;
  readonly contextTokens: typeof REQUIRED_LOCAL_CONTEXT;
  readonly leasePath: string;
  readonly logRoot?: string;
  readonly leaseWaitMs?: number;
  readonly leasePollMs?: number;
  /** Required fail-closed gate; callers must wire read-only local preflight. */
  readonly preflight?: () => Promise<boolean>;
}

export class OpenCodeWorkerAdapter implements ImplementationWorkerAdapter {
  readonly provider = "local" as const;
  private readonly active = new Map<number, OpenCodeProcess>();
  private readonly createProcess: OpenCodeProcessFactory;
  private readonly executable: string;
  private readonly logRoot: string;
  private readonly lease: LocalInferenceLease;
  constructor(createProcess: OpenCodeProcessFactory | undefined, private readonly options: OpenCodeRunnerOptions) {
    if (options.model !== AO_LOCAL_MODEL) throw new Error(`AO local worker model must equal ${AO_LOCAL_MODEL}`);
    if (options.contextTokens !== REQUIRED_LOCAL_CONTEXT) throw new Error(`AO local worker context must equal ${REQUIRED_LOCAL_CONTEXT}`);
    this.executable = options.executable ?? "opencode";
    this.createProcess = createProcess ?? ((invocation, cwd) => spawnOpenCode(invocation, cwd, this.executable));
    this.logRoot = options.logRoot ?? join(process.env.HOME ?? ".", ".local", "state", "agent-orchestrator", "logs");
    this.lease = new LocalInferenceLease({ path: options.leasePath, owner: "agent-orchestrator", model: options.model, ...(options.leaseWaitMs === undefined ? {} : { waitMs: options.leaseWaitMs }), ...(options.leasePollMs === undefined ? {} : { pollMs: options.leasePollMs }) });
  }

  start(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    return this.run({ kind: "new", prompt, model: this.options.model }, worktree, role, true);
  }

  async startDetached(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerProcessHandle> {
    return this.runDetached({ kind: "new", prompt, model: this.options.model }, worktree, role, true);
  }

  resume(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    return this.run({ kind: "resume", sessionId, prompt, model: this.options.model }, worktree, role, false);
  }

  async resumeDetached(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerProcessHandle> {
    return this.runDetached({ kind: "resume", sessionId, prompt, model: this.options.model }, worktree, role, false);
  }

  startRecovery(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerRunResult> {
    return this.run({ kind: "new", prompt: `${prompt}\n\nDurable recovery evidence:\n${JSON.stringify(evidence)}`, model: this.options.model }, worktree, "recovery", true);
  }

  async startRecoveryDetached(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerProcessHandle> {
    return this.runDetached({ kind: "new", prompt: `${prompt}\n\nDurable recovery evidence:\n${JSON.stringify(evidence)}`, model: this.options.model }, worktree, "recovery", true);
  }

  async retire(pid?: number): Promise<boolean> {
    if (pid === undefined) return false;
    let process = this.active.get(pid);
    for (let attempt = 0; process === undefined && attempt < 10; attempt += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      process = this.active.get(pid);
    }
    if (process === undefined) return false;
    process.kill("SIGTERM");
    return true;
  }

  private async run(invocation: OpenCodeInvocation, worktree: string, role: WorkerRole, fresh: boolean): Promise<WorkerRunResult> {
    const handle = await this.runDetached(invocation, worktree, role, fresh);
    return handle.completion;
  }

  private async runDetached(invocation: OpenCodeInvocation, worktree: string, role: WorkerRole, fresh: boolean): Promise<WorkerProcessHandle> {
    const logPath = await this.logPath(worktree);
    if (this.options.preflight === undefined || !(await this.options.preflight())) {
      await appendFile(logPath, `${JSON.stringify({ provider: "local", adapter: "opencode", role, pid: null, sessionId: null, outcome: "preflight-failed" })}\n`, "utf8");
      const run = { provider: "local" as const, adapter: "opencode" as const, role, sessionId: null, pid: undefined, outcome: "failed" as const, exitCode: null, stderr: [], logPath, fresh, resumable: false };
      return { started: { provider: "local", adapter: "opencode", role, sessionId: null, pid: undefined, logPath, fresh, resumable: false }, completion: Promise.resolve(run) };
    }
    const acquired = await this.lease.acquire();
    if (acquired.handle === undefined) {
      await appendFile(logPath, `${JSON.stringify({ provider: "local", adapter: "opencode", role, pid: null, sessionId: null, outcome: "lease-busy", lease: acquired.evidence })}\n`, "utf8");
      const run = { provider: "local" as const, adapter: "opencode" as const, role, sessionId: null, pid: undefined, outcome: "lease-busy" as const, exitCode: null, stderr: [], logPath, fresh, resumable: false, lease: acquired.evidence };
      return { started: { provider: "local", adapter: "opencode", role, sessionId: null, pid: undefined, logPath, fresh, resumable: false, lease: acquired.evidence }, completion: Promise.resolve(run) };
    }
    const leaseHandle = acquired.handle;
    let process: OpenCodeProcess;
    try {
      process = this.createProcess(invocation, worktree);
    } catch {
      const completion = (async (): Promise<WorkerRunResult> => {
        let lease: LeaseEvidence;
        try { lease = await leaseHandle.release(); } catch { lease = { ...acquired.evidence, status: "release-skipped" }; }
        await appendFile(logPath, `${JSON.stringify({ provider: "local", adapter: "opencode", role, pid: null, sessionId: null, outcome: "spawn-error", lease })}\n`, "utf8");
        return { provider: "local", adapter: "opencode", role, sessionId: null, pid: undefined, outcome: "spawn-error", exitCode: null, stderr: [], logPath, fresh, resumable: false, lease };
      })();
      return { started: { provider: "local", adapter: "opencode", role, sessionId: null, pid: undefined, logPath, fresh, resumable: false, lease: acquired.evidence }, completion };
    }
    if (process.pid !== undefined) this.active.set(process.pid, process);
    const stdoutRead = collect(process.stdout);
    const stderrRead = collect(process.stderr);
    const completion = (async (): Promise<WorkerRunResult> => {
      let lease: LeaseEvidence = acquired.evidence;
      let result: WorkerRunResult;
      try {
        const [stdout, stderr, exitCode, exitReason] = await Promise.all([stdoutRead, stderrRead, process.exitCode, process.exitReason]);
        const observation = observeOpenCodeOutput(stdout, exitCode, exitReason);
        const evidence = {
          provider: "local",
          adapter: "opencode",
          role,
          pid: process.pid ?? null,
          sessionId: observation.sessionId,
          outcome: observation.outcome,
          availabilityReason: observation.availabilityReason ?? null,
          exitCode: observation.exitCode,
          exitReason: observation.exitReason,
          eventTypes: observation.events.map((event) => /^[A-Za-z0-9._:-]{1,64}$/.test(event.type) ? event.type : "<unrecognized>"),
          stderrLineCount: stderr.length,
          lease,
        };
        await appendFile(logPath, `${JSON.stringify(evidence)}\n`, "utf8");
        result = { provider: "local", adapter: "opencode", role, sessionId: observation.sessionId, pid: process.pid, outcome: observation.outcome, ...(observation.availabilityReason === undefined ? {} : { availabilityReason: observation.availabilityReason }), exitCode, stderr, logPath, fresh, resumable: observation.sessionId !== null && observation.outcome === "success", lease };
      } catch {
        try { process.kill("SIGTERM"); } catch { /* process may already be gone */ }
        await Promise.allSettled([process.exitCode, process.exitReason, stdoutRead, stderrRead]);
        result = { provider: "local", adapter: "opencode", role, sessionId: null, pid: process.pid, outcome: "spawn-error", exitCode: null, stderr: [], logPath, fresh, resumable: false, lease };
        await appendFile(logPath, `${JSON.stringify({ provider: "local", adapter: "opencode", role, pid: process.pid ?? null, sessionId: null, outcome: "spawn-error", lease })}\n`, "utf8");
      } finally {
        if (process.pid !== undefined) this.active.delete(process.pid);
        try {
          lease = await leaseHandle.release();
        } catch {
          lease = { ...acquired.evidence, status: "release-skipped" };
        }
      }
      await appendFile(logPath, `${JSON.stringify({ provider: "local", adapter: "opencode", lease })}\n`, "utf8");
      return { ...result, lease };
    })();
    return { started: { provider: "local", adapter: "opencode", role, sessionId: null, pid: process.pid, logPath, fresh, resumable: false, lease: acquired.evidence }, completion };
  }

  private async logPath(worktree: string): Promise<string> {
    await mkdir(this.logRoot, { recursive: true });
    return join(this.logRoot, `${basename(worktree)}-opencode.jsonl`);
  }
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const line of lines) result.push(line);
  return result;
}

export type { OpenCodeOutcome, AvailabilityLimitReason };
