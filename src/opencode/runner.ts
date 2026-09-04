import { appendFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { WorkerRole } from "../config/index.js";
import { OpenCodeInvocation, OpenCodeProcess, OpenCodeOutcome, AvailabilityLimitReason, observeOpenCodeOutput, spawnOpenCode } from "./lifecycle.js";
import { ImplementationWorkerAdapter, WorkerRecoveryEvidence, WorkerRunResult } from "../worker/index.js";

export type OpenCodeProcessFactory = (invocation: OpenCodeInvocation, cwd: string) => OpenCodeProcess;
export interface OpenCodeRunnerOptions { readonly executable?: string; readonly model: string; readonly logRoot?: string; }

export class OpenCodeWorkerAdapter implements ImplementationWorkerAdapter {
  readonly provider = "local" as const;
  private readonly active = new Map<number, OpenCodeProcess>();
  private readonly createProcess: OpenCodeProcessFactory;
  private readonly executable: string;
  private readonly logRoot: string;
  constructor(createProcess: OpenCodeProcessFactory | undefined, private readonly options: OpenCodeRunnerOptions) {
    this.executable = options.executable ?? "opencode";
    this.createProcess = createProcess ?? ((invocation, cwd) => spawnOpenCode(invocation, cwd, this.executable));
    this.logRoot = options.logRoot ?? join(process.env.HOME ?? ".", ".local", "state", "agent-orchestrator", "logs");
  }

  start(prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    return this.run({ kind: "new", prompt, model: this.options.model }, worktree, role, true);
  }

  resume(sessionId: string, prompt: string, worktree: string, role: WorkerRole): Promise<WorkerRunResult> {
    return this.run({ kind: "resume", sessionId, prompt, model: this.options.model }, worktree, role, false);
  }

  startRecovery(evidence: WorkerRecoveryEvidence, prompt: string, worktree: string): Promise<WorkerRunResult> {
    return this.run({ kind: "new", prompt: `${prompt}\n\nDurable recovery evidence:\n${JSON.stringify(evidence)}`, model: this.options.model }, worktree, "recovery", true);
  }

  async retire(pid?: number): Promise<boolean> {
    if (pid === undefined) return false;
    const process = this.active.get(pid);
    if (process === undefined) return false;
    process.kill("SIGTERM");
    return true;
  }

  private async run(invocation: OpenCodeInvocation, worktree: string, role: WorkerRole, fresh: boolean): Promise<WorkerRunResult> {
    const process = this.createProcess(invocation, worktree);
    if (process.pid !== undefined) this.active.set(process.pid, process);
    try {
      const [stdout, stderr, exitCode, exitReason] = await Promise.all([collect(process.stdout), collect(process.stderr), process.exitCode, process.exitReason]);
      const observation = observeOpenCodeOutput(stdout, exitCode, exitReason);
      const logPath = join(this.logRoot, `${basename(worktree)}-opencode.jsonl`);
      await mkdir(this.logRoot, { recursive: true });
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
      };
      await appendFile(logPath, `${JSON.stringify(evidence)}\n`, "utf8");
      return { provider: "local", adapter: "opencode", role, sessionId: observation.sessionId, pid: process.pid, outcome: observation.outcome, ...(observation.availabilityReason === undefined ? {} : { availabilityReason: observation.availabilityReason }), exitCode, stderr, logPath, fresh, resumable: observation.sessionId !== null && observation.outcome === "success" };
    } finally {
      if (process.pid !== undefined) this.active.delete(process.pid);
    }
  }
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const line of lines) result.push(line);
  return result;
}

export type { OpenCodeOutcome, AvailabilityLimitReason };
