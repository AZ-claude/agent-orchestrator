import { isAbsolute, relative, resolve } from "node:path";

/**
 * Runtime contracts shared by the daemon components.
 *
 * These schemas deliberately validate shape and local invariants only. DAG
 * validation belongs to the canonical manifest loader (AO-03), while process,
 * Git, and Issue state validation belongs to later adapters.
 */

export const EXECUTION_STATES = [
  "ready",
  "running",
  "paused",
  "worker-done",
  "reviewing",
  "rework",
  "blocked-human",
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const PARALLEL_POLICIES = ["SAFE", "EXCLUSIVE"] as const;

export type ParallelPolicy = (typeof PARALLEL_POLICIES)[number];

export const CHECKPOINT_PHASES = ["luna", "terra"] as const;

export type CheckpointPhase = (typeof CHECKPOINT_PHASES)[number];

export const REVIEW_RESULTS = ["APPROVE", "REWORK", "BLOCKED_HUMAN"] as const;

export type ReviewResultKind = (typeof REVIEW_RESULTS)[number];

/** v1 is intentionally limited to the first pilot repository. */
export const PILOT_TARGET_REPO = "/Users/eita/projects/slot";

export interface PilotConfig {
  readonly version: 1;
  readonly pilot: {
    readonly targetRepo: string;
    readonly baseBranch: string;
    readonly manifestPath: string;
    readonly boardPath: string;
  };
  /** Directory outside the target repository for durable daemon state. */
  readonly stateRoot: string;
  readonly pollIntervalMs: number;
  readonly maxLunaWorkers: number;
  readonly maxResumeAttempts: number;
  readonly retryIntervalMs: number;
}

export interface ManifestHandoff {
  readonly id: string;
  readonly source: string;
  readonly board: string;
  readonly targetRepo: string;
  readonly baseBranch: string;
}

export interface ManifestTask {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly parallel: ParallelPolicy;
  readonly humanGate: boolean;
  readonly allowedPaths: readonly string[];
  readonly test: string;
}

export interface TaskManifest {
  readonly handoff: ManifestHandoff;
  readonly tasks: readonly ManifestTask[];
}

/**
 * The checkpoint intentionally contains only process/session recovery data.
 * It must not grow to include task requirements, prompts, or credentials.
 */
export interface Checkpoint {
  readonly issueNumber: number;
  readonly taskId: string;
  readonly phase: CheckpointPhase;
  readonly attempt: number;
  readonly sessionId: string | null;
  readonly branch: string;
  readonly worktree: string;
  readonly pid: number | null;
  readonly lastHead: string | null;
  readonly retryAt: string | null;
}

export type ReviewResult =
  | { readonly result: "APPROVE" }
  | { readonly result: "REWORK"; readonly reason: string }
  | { readonly result: "BLOCKED_HUMAN"; readonly reason: string };

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class SchemaValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(schemaName: string, issues: readonly ValidationIssue[]) {
    super(`${schemaName} validation failed: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

const DEFAULT_CONFIG: PilotConfig = {
  version: 1,
  pilot: {
    targetRepo: PILOT_TARGET_REPO,
    baseBranch: "main",
    manifestPath: "tasks/agent-orchestrator-v1.yaml",
    boardPath: "docs/task-boards/2026-08-31-agent-orchestrator-v1.md",
  },
  stateRoot: "/Users/eita/.local/state/agent-orchestrator",
  pollIntervalMs: 30_000,
  maxLunaWorkers: 2,
  maxResumeAttempts: 2,
  retryIntervalMs: 300_000,
};

/** Safe defaults for the single `/slot` pilot. A caller receives a fresh tree. */
export function defaultPilotConfig(): PilotConfig {
  return clone(DEFAULT_CONFIG);
}

export function parsePilotConfig(value: unknown): PilotConfig {
  return parseWith("pilot config", value, validatePilotConfig);
}

export function parseManifest(value: unknown): TaskManifest {
  return parseWith("task manifest", value, (input, path, issues) => validateManifest(input, path, issues, PILOT_TARGET_REPO));
}

export function parseManifestForPilot(value: unknown, config: Pick<PilotConfig, "pilot">): TaskManifest {
  if (config.pilot.targetRepo !== PILOT_TARGET_REPO) {
    throw new SchemaValidationError("task manifest", [{ path: "$.pilot.targetRepo", message: `must equal the v1 pilot target ${PILOT_TARGET_REPO}` }]);
  }
  return parseWith("task manifest", value, (input, path, issues) => validateManifest(input, path, issues, config.pilot.targetRepo));
}

export function parseCheckpoint(value: unknown): Checkpoint {
  return parseWith("checkpoint", value, validateCheckpoint);
}

export function parseReviewResult(value: unknown): ReviewResult {
  return parseWith("review result", value, validateReviewResult);
}

export interface SafeParseSuccess<T> {
  readonly success: true;
  readonly data: T;
}

export interface SafeParseFailure {
  readonly success: false;
  readonly error: SchemaValidationError;
}

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

export const configSchema = makeSchema(parsePilotConfig);
export const manifestSchema = {
  parse(value: unknown, config?: Pick<PilotConfig, "pilot">): TaskManifest {
    return config === undefined ? parseManifest(value) : parseManifestForPilot(value, config);
  },
  safeParse(value: unknown, config?: Pick<PilotConfig, "pilot">): SafeParseResult<TaskManifest> {
    try {
      const data = config === undefined ? parseManifest(value) : parseManifestForPilot(value, config);
      return { success: true, data };
    } catch (error) {
      if (error instanceof SchemaValidationError) return { success: false, error };
      throw error;
    }
  },
};
export const checkpointSchema = makeSchema(parseCheckpoint);
export const reviewResultSchema = makeSchema(parseReviewResult);

type Validator<T> = (value: unknown, path: string, issues: ValidationIssue[]) => T | undefined;

function parseWith<T>(schemaName: string, value: unknown, validator: Validator<T>): T {
  const issues: ValidationIssue[] = [];
  const parsed = validator(value, "$", issues);
  if (issues.length > 0 || parsed === undefined) {
    throw new SchemaValidationError(schemaName, issues.length > 0 ? issues : [{ path: "$", message: "is invalid" }]);
  }
  return parsed;
}

function makeSchema<T>(parse: (value: unknown) => T) {
  return {
    parse,
    safeParse(value: unknown): SafeParseResult<T> {
      try {
        return { success: true, data: parse(value) };
      } catch (error) {
        if (error instanceof SchemaValidationError) {
          return { success: false, error };
        }
        throw error;
      }
    },
  };
}

function validatePilotConfig(value: unknown, path: string, issues: ValidationIssue[]): PilotConfig | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be an object"));
    return undefined;
  }
  rejectUnknown(value, ["version", "pilot", "stateRoot", "pollIntervalMs", "maxLunaWorkers", "maxResumeAttempts", "retryIntervalMs"], path, issues);
  const version = requiredLiteral(value, "version", 1, path, issues);
  const pilot = requiredRecord(value, "pilot", path, issues);
  const stateRoot = requiredAbsolutePathOutside(value, "stateRoot", PILOT_TARGET_REPO, path, issues);
  const pollIntervalMs = requiredPositiveInteger(value, "pollIntervalMs", path, issues);
  const maxLunaWorkers = requiredPositiveInteger(value, "maxLunaWorkers", path, issues);
  const maxResumeAttempts = requiredNonNegativeInteger(value, "maxResumeAttempts", path, issues);
  const retryIntervalMs = requiredPositiveInteger(value, "retryIntervalMs", path, issues);

  if (pilot) {
    rejectUnknown(pilot, ["targetRepo", "baseBranch", "manifestPath", "boardPath"], `${path}.pilot`, issues);
  }
  const targetRepo = pilot ? requiredPilotTarget(pilot, "targetRepo", `${path}.pilot`, issues) : undefined;
  const baseBranch = pilot ? requiredString(pilot, "baseBranch", `${path}.pilot`, issues) : undefined;
  const manifestPath = pilot ? requiredRelativePath(pilot, "manifestPath", `${path}.pilot`, issues) : undefined;
  const boardPath = pilot ? requiredRelativePath(pilot, "boardPath", `${path}.pilot`, issues) : undefined;

  if (
    version === 1 &&
    targetRepo !== undefined &&
    baseBranch !== undefined &&
    manifestPath !== undefined &&
    boardPath !== undefined &&
    stateRoot !== undefined &&
    pollIntervalMs !== undefined &&
    maxLunaWorkers !== undefined &&
    maxResumeAttempts !== undefined &&
    retryIntervalMs !== undefined
  ) {
    return { version, pilot: { targetRepo, baseBranch, manifestPath, boardPath }, stateRoot, pollIntervalMs, maxLunaWorkers, maxResumeAttempts, retryIntervalMs };
  }
  return undefined;
}

function validateManifest(value: unknown, path: string, issues: ValidationIssue[], expectedTargetRepo: string): TaskManifest | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be an object"));
    return undefined;
  }
  rejectUnknown(value, ["handoff", "tasks"], path, issues);
  const handoff = requiredRecord(value, "handoff", path, issues);
  const tasks = requiredArray(value, "tasks", path, issues);
  if (handoff) {
    rejectUnknown(handoff, ["id", "source", "board", "targetRepo", "baseBranch"], `${path}.handoff`, issues);
  }
  const handoffValue = handoff ? validateManifestHandoff(handoff, `${path}.handoff`, issues, expectedTargetRepo) : undefined;
  const taskValues = tasks?.map((task, index) => validateManifestTask(task, `${path}.tasks[${index}]`, issues));
  if (handoffValue !== undefined && taskValues !== undefined && taskValues.every(isDefined)) {
    return { handoff: handoffValue, tasks: taskValues };
  }
  return undefined;
}

function validateManifestHandoff(value: Record<string, unknown>, path: string, issues: ValidationIssue[], expectedTargetRepo: string): ManifestHandoff | undefined {
  const id = requiredString(value, "id", path, issues);
  const source = requiredRelativePath(value, "source", path, issues);
  const board = requiredRelativePath(value, "board", path, issues);
  const targetRepo = requiredExpectedTarget(value, "targetRepo", expectedTargetRepo, path, issues);
  const baseBranch = requiredString(value, "baseBranch", path, issues);
  if (id !== undefined && source !== undefined && board !== undefined && targetRepo !== undefined && baseBranch !== undefined) {
    return { id, source, board, targetRepo, baseBranch };
  }
  return undefined;
}

function validateManifestTask(value: unknown, path: string, issues: ValidationIssue[]): ManifestTask | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be an object"));
    return undefined;
  }
  rejectUnknown(value, ["id", "title", "dependsOn", "parallel", "humanGate", "allowedPaths", "test"], path, issues);
  const id = requiredString(value, "id", path, issues);
  const title = requiredString(value, "title", path, issues);
  const dependsOn = requiredStringArray(value, "dependsOn", path, issues);
  const parallel = requiredEnum(value, "parallel", PARALLEL_POLICIES, path, issues);
  const humanGate = requiredBoolean(value, "humanGate", path, issues);
  const allowedPaths = requiredRepoRelativeGlobArray(value, "allowedPaths", path, issues);
  const test = requiredString(value, "test", path, issues);
  if (id !== undefined && title !== undefined && dependsOn !== undefined && parallel !== undefined && humanGate !== undefined && allowedPaths !== undefined && test !== undefined) {
    return { id, title, dependsOn, parallel, humanGate, allowedPaths, test };
  }
  return undefined;
}

function validateCheckpoint(value: unknown, path: string, issues: ValidationIssue[]): Checkpoint | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be an object"));
    return undefined;
  }
  rejectUnknown(value, ["issueNumber", "taskId", "phase", "attempt", "sessionId", "branch", "worktree", "pid", "lastHead", "retryAt"], path, issues);
  const issueNumber = requiredPositiveInteger(value, "issueNumber", path, issues);
  const taskId = requiredString(value, "taskId", path, issues);
  const phase = requiredEnum(value, "phase", CHECKPOINT_PHASES, path, issues);
  const attempt = requiredPositiveInteger(value, "attempt", path, issues);
  const sessionId = requiredNullableString(value, "sessionId", path, issues);
  const branch = requiredString(value, "branch", path, issues);
  const worktree = requiredAbsolutePath(value, "worktree", path, issues);
  const pid = requiredNullablePositiveInteger(value, "pid", path, issues);
  const lastHead = requiredNullableString(value, "lastHead", path, issues);
  const retryAt = requiredNullableIsoDate(value, "retryAt", path, issues);
  if (issueNumber !== undefined && taskId !== undefined && phase !== undefined && attempt !== undefined && sessionId !== undefined && branch !== undefined && worktree !== undefined && pid !== undefined && lastHead !== undefined && retryAt !== undefined) {
    return { issueNumber, taskId, phase, attempt, sessionId, branch, worktree, pid, lastHead, retryAt };
  }
  return undefined;
}

function validateReviewResult(value: unknown, path: string, issues: ValidationIssue[]): ReviewResult | undefined {
  if (!isRecord(value)) {
    issues.push(issue(path, "must be an object"));
    return undefined;
  }
  const result = requiredEnum(value, "result", REVIEW_RESULTS, path, issues);
  if (result === undefined) return undefined;
  if (result === "APPROVE") {
    rejectUnknown(value, ["result"], path, issues);
    return issuesForPath(issues, path) ? undefined : { result };
  }
  rejectUnknown(value, ["result", "reason"], path, issues);
  const reason = requiredString(value, "reason", path, issues);
  if (reason !== undefined && !issuesForPath(issues, path)) return { result, reason };
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) issues.push(issue(`${path}.${key}`, "is not allowed"));
  }
}

function requiredRecord(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): Record<string, unknown> | undefined {
  const nested = value[key];
  if (!isRecord(nested)) {
    issues.push(issue(`${path}.${key}`, "must be an object"));
    return undefined;
  }
  return nested;
}

function requiredArray(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): readonly unknown[] | undefined {
  const nested = value[key];
  if (!Array.isArray(nested)) {
    issues.push(issue(`${path}.${key}`, "must be an array"));
    return undefined;
  }
  return nested;
}

function requiredString(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.trim() === "") {
    issues.push(issue(`${path}.${key}`, "must be a non-empty string"));
    return undefined;
  }
  return candidate;
}

function requiredAbsolutePath(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = requiredString(value, key, path, issues);
  if (candidate !== undefined && !isAbsolute(candidate)) {
    issues.push(issue(`${path}.${key}`, "must be an absolute path"));
    return undefined;
  }
  return candidate;
}

function requiredPilotTarget(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = requiredAbsolutePath(value, key, path, issues);
  if (candidate !== undefined && candidate !== PILOT_TARGET_REPO) {
    issues.push(issue(`${path}.${key}`, `must equal the v1 pilot target ${PILOT_TARGET_REPO}`));
    return undefined;
  }
  return candidate;
}

function requiredExpectedTarget(value: Record<string, unknown>, key: string, expected: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = requiredAbsolutePath(value, key, path, issues);
  if (candidate !== undefined && candidate !== expected) {
    issues.push(issue(`${path}.${key}`, `must match the configured pilot target ${expected}`));
    return undefined;
  }
  return candidate;
}

function requiredAbsolutePathOutside(value: Record<string, unknown>, key: string, targetRepo: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = requiredAbsolutePath(value, key, path, issues);
  if (candidate !== undefined && isWithinPath(candidate, targetRepo)) {
    issues.push(issue(`${path}.${key}`, "must be outside the pilot target repository"));
    return undefined;
  }
  return candidate;
}

function requiredRelativePath(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | undefined {
  const candidate = requiredString(value, key, path, issues);
  if (candidate !== undefined && (candidate.startsWith("/") || candidate.split("/").includes(".."))) {
    issues.push(issue(`${path}.${key}`, "must be a repository-relative path"));
    return undefined;
  }
  return candidate;
}

function requiredBoolean(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): boolean | undefined {
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    issues.push(issue(`${path}.${key}`, "must be a boolean"));
    return undefined;
  }
  return candidate;
}

function requiredLiteral<T extends string | number>(value: Record<string, unknown>, key: string, expected: T, path: string, issues: ValidationIssue[]): T | undefined {
  if (value[key] !== expected) {
    issues.push(issue(`${path}.${key}`, `must equal ${String(expected)}`));
    return undefined;
  }
  return expected;
}

function requiredEnum<T extends string>(value: Record<string, unknown>, key: string, allowed: readonly T[], path: string, issues: ValidationIssue[]): T | undefined {
  const candidate = value[key];
  if (typeof candidate !== "string" || !allowed.includes(candidate as T)) {
    issues.push(issue(`${path}.${key}`, `must be one of ${allowed.join(", ")}`));
    return undefined;
  }
  return candidate as T;
}

function requiredPositiveInteger(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): number | undefined {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1) {
    issues.push(issue(`${path}.${key}`, "must be a positive integer"));
    return undefined;
  }
  return candidate;
}

function requiredNonNegativeInteger(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): number | undefined {
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 0) {
    issues.push(issue(`${path}.${key}`, "must be a non-negative integer"));
    return undefined;
  }
  return candidate;
}

function requiredNullablePositiveInteger(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): number | null | undefined {
  const candidate = value[key];
  if (candidate === null) return null;
  if (typeof candidate !== "number" || !Number.isInteger(candidate) || candidate < 1) {
    issues.push(issue(`${path}.${key}`, "must be a positive integer or null"));
    return undefined;
  }
  return candidate;
}

function requiredNullableString(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | null | undefined {
  const candidate = value[key];
  if (candidate === null) return null;
  if (typeof candidate !== "string" || candidate.trim() === "") {
    issues.push(issue(`${path}.${key}`, "must be a non-empty string or null"));
    return undefined;
  }
  return candidate;
}

function requiredNullableIsoDate(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string | null | undefined {
  const candidate = requiredNullableString(value, key, path, issues);
  if (candidate !== null && candidate !== undefined && Number.isNaN(Date.parse(candidate))) {
    issues.push(issue(`${path}.${key}`, "must be an ISO-compatible date or null"));
    return undefined;
  }
  return candidate;
}

function requiredStringArray(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): readonly string[] | undefined {
  const candidates = requiredArray(value, key, path, issues);
  if (candidates === undefined) return undefined;
  const strings: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      issues.push(issue(`${path}.${key}[${index}]`, "must be a non-empty string"));
    } else {
      strings.push(candidate);
    }
  }
  return strings.length === candidates.length ? strings : undefined;
}

function requiredRepoRelativeGlobArray(value: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): readonly string[] | undefined {
  const candidates = requiredArray(value, key, path, issues);
  if (candidates === undefined) return undefined;
  const globs: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (typeof candidate !== "string" || candidate.trim() === "") {
      issues.push(issue(`${path}.${key}[${index}]`, "must be a non-empty repository-relative glob"));
    } else if (!isRepoRelativeGlob(candidate)) {
      issues.push(issue(`${path}.${key}[${index}]`, "must be a repository-relative glob that cannot escape the repository"));
    } else {
      globs.push(candidate);
    }
  }
  return globs.length === candidates.length ? globs : undefined;
}

function isRepoRelativeGlob(candidate: string): boolean {
  if (candidate.includes("\0") || candidate.includes("\\") || candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)) return false;
  const segments = candidate.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  const normalized = resolve("/repo", candidate);
  return normalized === "/repo" || normalized.startsWith("/repo/");
}

function isWithinPath(candidate: string, parent: string): boolean {
  const candidatePath = resolve(candidate);
  const parentPath = resolve(parent);
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent));
}

function issuesForPath(issues: readonly ValidationIssue[], path: string): boolean {
  return issues.some((item) => item.path === path || item.path.startsWith(`${path}.`));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
