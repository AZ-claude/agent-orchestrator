import { CodexInvocation, CodexLifecycleObservation, CodexProcess, observeCodexOutput, spawnCodex } from "../codex/index.js";

export interface LunaRunResult extends CodexLifecycleObservation {
  readonly pid: number | undefined;
  readonly stderr: readonly string[];
}
export type ProcessFactory = (invocation: CodexInvocation, cwd: string) => CodexProcess;

export class LunaRunner {
  constructor(private readonly createProcess: ProcessFactory = spawnCodex) {}

  start(prompt: string, worktree: string): Promise<LunaRunResult> {
    return this.run({ kind: "new", prompt }, worktree);
  }
  resume(sessionId: string, prompt: string, worktree: string): Promise<LunaRunResult> {
    return this.run({ kind: "resume", sessionId, prompt }, worktree);
  }

  private async run(invocation: CodexInvocation, worktree: string): Promise<LunaRunResult> {
    const process = this.createProcess(invocation, worktree);
    const [stdout, stderr, exitCode] = await Promise.all([collect(process.stdout), collect(process.stderr), process.exitCode]);
    const observation = observeCodexOutput(stdout, exitCode);
    return { ...observation, pid: process.pid, stderr };
  }
}

async function collect(lines: AsyncIterable<string>): Promise<string[]> {
  const result: string[] = [];
  for await (const line of lines) result.push(line);
  return result;
}
