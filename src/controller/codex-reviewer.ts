import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parsePlanConflictClaim } from "../config/index.js";
import { IndependentReview } from "../luna/index.js";
import { ReviewPacket } from "../validation/index.js";
import { IndependentReviewer } from "./controller.js";

const run = promisify(execFile);

export interface ReadOnlyReviewerInvocation {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export type ReadOnlyReviewerExecutor = (invocation: ReadOnlyReviewerInvocation) => Promise<{ readonly stdout: string }>;

/**
 * A fresh, sandboxed Codex process used only for semantic review. This is not
 * a resumed implementation session: it gets a review packet and read-only
 * worktree access, never an implementation prompt, session ID, or history.
 */
export class CodexReadOnlyReviewer implements IndependentReviewer {
  constructor(
    private readonly executable = "codex",
    private readonly execute: ReadOnlyReviewerExecutor = executeCodexReadOnly,
  ) {}

  async review(packet: ReviewPacket): Promise<Awaited<ReturnType<IndependentReviewer["review"]>>> {
    try {
      const result = await this.execute({
        executable: this.executable,
        // A new exec invocation intentionally has no --resume/session input.
        args: ["exec", "--sandbox", "read-only", buildReviewPrompt(packet)],
        cwd: packet.worktree,
      });
      return parseReview(result.stdout);
    } catch (error) {
      return capabilityUnavailable(error instanceof Error ? error.message : String(error));
    }
  }
}

async function executeCodexReadOnly(invocation: ReadOnlyReviewerInvocation): Promise<{ readonly stdout: string }> {
  const result = await run(invocation.executable, [...invocation.args], { cwd: invocation.cwd, maxBuffer: 2 * 1024 * 1024, timeout: 120_000 });
  return { stdout: result.stdout };
}

/** Minimal canonical review input; deliberately excludes worker/rework history. */
export function buildReviewPrompt(packet: ReviewPacket): string {
  return [
    "You are an independent code reviewer. Inspect only the committed source HEAD below and the machine evidence.",
    "Your context is independent: no implementation conversation, session, prompt, or rework history is available or authorized.",
    "READ-ONLY CONTRACT: do not edit files, stage, commit, push, merge, create branches, run formatters with writes, or otherwise modify the worktree.",
    "Return exactly one JSON object and no prose:",
    '{"result":"APPROVE"}',
    '{"result":"REWORK","reason":"specific actionable finding","findingId":"optional-stable-id"}',
    '{"result":"PLAN_CONFLICT","claim":{"conflictType":"PLAN_CONFLICT","taskId":"...","canonicalRequirementRefs":["..."],"conflictingTaskFields":["..."],"repoEvidence":["..."],"whyWorkerCannotResolveWithinScope":"..."}}',
    'or {"result":"PLAN_CONFLICT_CONFIRMED","claim":{...same claim...}}.',
    "Do not approve if required evidence is missing. A malformed response is treated as capability unavailable.",
    "Canonical task scope and machine evidence:",
    reviewEvidence(packet),
  ].join("\n\n");
}

function reviewEvidence(packet: ReviewPacket): string {
  return [
    `Task: ${packet.taskId}`,
    `Canonical task: ${packet.canonicalTask}`,
    `Acceptance: ${packet.acceptance}`,
    `Source HEAD: ${packet.head}`,
    `Base ref: ${packet.baseRef}`,
    `Branch: ${packet.branch}`,
    `Worktree (read-only inspection): ${packet.worktree}`,
    `Changed files: ${packet.changedFiles.length === 0 ? "NONE" : packet.changedFiles.join(", ")}`,
    `Unexpected files: ${packet.unexpectedFiles.length === 0 ? "NONE" : packet.unexpectedFiles.join(", ")}`,
    `Machine gates: pushed=${packet.pushed}; clean=${packet.clean}; scope=${packet.scope}; dependencies=${packet.dependencies}; branch=${packet.branchCheck ?? "UNKNOWN"}; worktree=${packet.worktreeCheck ?? "UNKNOWN"}; baseAncestor=${packet.baseAncestor ?? "UNKNOWN"}`,
    `Test: ${packet.test.pass ? "PASS" : "FAIL"}; command=${packet.test.command}; exit=${packet.test.exitCode}`,
    `Assumptions: ${packet.assumptions?.join(" | ") || "NONE"}`,
    `Invariants: ${packet.invariants?.join(" | ") || "NONE"}`,
  ].join("\n");
}

export function parseReview(output: string): IndependentReview | { readonly result: "CAPABILITY_UNAVAILABLE"; readonly reason: string } {
  const candidate = lastJsonObject(output);
  if (candidate === undefined) return capabilityUnavailable("read-only reviewer did not return a structured JSON object");
  if (!isRecord(candidate) || typeof candidate.result !== "string") return capabilityUnavailable("read-only reviewer result is malformed");
  if (candidate.result === "APPROVE" && Object.keys(candidate).length === 1) return "APPROVE";
  if (candidate.result === "REWORK" && typeof candidate.reason === "string" && candidate.reason.trim() !== "") {
    return {
      result: "REWORK",
      reason: candidate.reason,
      ...(typeof candidate.findingId === "string" ? { findingId: candidate.findingId } : {}),
      ...(typeof candidate.testFailureSignature === "string" ? { testFailureSignature: candidate.testFailureSignature } : {}),
      ...(typeof candidate.diffFingerprint === "string" ? { diffFingerprint: candidate.diffFingerprint } : {}),
    };
  }
  if ((candidate.result === "PLAN_CONFLICT" || candidate.result === "PLAN_CONFLICT_CONFIRMED") && candidate.claim !== undefined) {
    try {
      const claim = parsePlanConflictClaim(candidate.claim);
      return { result: candidate.result, claim };
    } catch {
      return capabilityUnavailable("read-only reviewer plan-conflict claim is malformed");
    }
  }
  return capabilityUnavailable(`read-only reviewer returned unsupported result ${JSON.stringify(candidate.result)}`);
}

function lastJsonObject(output: string): unknown | undefined {
  let last: unknown;
  let lastResultObject: unknown;
  for (let start = 0; start < output.length; start += 1) {
    if (output[start] !== "{") continue;
    const end = jsonObjectEnd(output, start);
    if (end === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(output.slice(start, end + 1));
      last = parsed;
      if (isRecord(parsed) && typeof parsed.result === "string") lastResultObject = parsed;
    } catch {
      // This brace was not a complete JSON object. Continue looking for Codex's
      // final structured response rather than treating progress output as one.
    }
  }
  return lastResultObject ?? last;
}

function jsonObjectEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") quoted = false;
      continue;
    }
    if (char === "\"") { quoted = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function capabilityUnavailable(reason: string): { readonly result: "CAPABILITY_UNAVAILABLE"; readonly reason: string } {
  return { result: "CAPABILITY_UNAVAILABLE", reason: `read-only reviewer unavailable: ${reason}` };
}
