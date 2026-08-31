import { CodexInvocation, CodexProcess, spawnCodex } from "../codex/index.js";
import { parseReviewResult, ReviewResult } from "../config/index.js";
import { ReviewPacket, compactReviewPacket } from "../validation/index.js";

export interface TerraRunResult { readonly result: ReviewResult; readonly sessionId: string | null; readonly raw: string; }
export type TerraProcessFactory = (invocation: CodexInvocation, cwd: string) => CodexProcess;

export function terraReviewPrompt(packet: ReviewPacket): string {
  return `${compactReviewPacket(packet)}\n\nReturn exactly one JSON object with result APPROVE, REWORK, or BLOCKED_HUMAN. For REWORK/BLOCKED_HUMAN include a concrete reason. Do not invent machine evidence.`;
}

export class TerraReviewRunner {
  constructor(private readonly createProcess: TerraProcessFactory = spawnCodex) {}

  async review(savedSessionId: string, packet: ReviewPacket, cwd: string): Promise<TerraRunResult> {
    const process = this.createProcess({ kind: "resume", sessionId: savedSessionId, prompt: terraReviewPrompt(packet) }, cwd);
    const lines: string[] = [];
    for await (const line of process.stdout) lines.push(line);
    const exitCode = await process.exitCode;
    if (exitCode !== 0) throw new Error(`Terra process failed with exit code ${String(exitCode)}`);
    const raw = lines.join("\n");
    return { result: parseTerraResult(raw), sessionId: savedSessionId, raw };
  }
}

export function parseTerraResult(raw: string): ReviewResult {
  const text = raw.trim();
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("Terra response must be a JSON object"); }
  return parseReviewResult(value);
}
