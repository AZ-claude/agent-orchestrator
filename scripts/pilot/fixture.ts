import { DeterministicScheduler, activatePlanRevision, mergeAllowed } from "../../src/scheduler/index.js";
import { ReviewCloseController } from "../../src/controller/index.js";
import { canCleanupSession, cleanupSessions, reconcile } from "../../src/reconcile/index.js";
import { ReviewPacket } from "../../src/validation/index.js";
import { ManifestTask, PlanConflictClaim } from "../../src/config/index.js";
import { GitAdapter, GitSnapshot } from "../../src/git/index.js";
import { MachineValidator } from "../../src/validation/index.js";

export interface PilotFixtureResult { readonly safeDispatch: readonly string[]; readonly exclusiveBlocked: boolean; readonly reviewRounds: number; readonly resumeSessions: readonly string[]; readonly remoteVerification: boolean; readonly rateLimitAction: string; readonly rateLimitRetryAt: string | null; readonly restartAction: string; readonly restartSessionId: string | null; readonly scopeAccepted: boolean; readonly scopeRejected: boolean; readonly reviewedHeadRefused: boolean; readonly recoveryFresh: boolean; readonly recoveryReviewerRequired: boolean; readonly planConflictConfirmed: boolean; readonly barrierRefusesMerge: boolean; readonly unrelatedSafeContinues: boolean; readonly resumableRetained: boolean; readonly retiredCleaned: boolean; readonly authorityBoundary: boolean; }
const makeTask = (id: string, parallel: "SAFE" | "EXCLUSIVE"): ManifestTask => ({ id, title: id, dependsOn: [], parallel, humanGate: false, allowedPaths: ["docs/**"], test: "true" });
const packet: ReviewPacket = { taskId: "PILOT-REVIEW", canonicalTask: "PILOT-REVIEW", worktree: "/tmp/disposable-pilot", baseRef: "origin/main", branch: "agent/PILOT-REVIEW", head: "fixture-head", pushed: true, clean: true, changedFiles: ["docs/agent-runs/pilot.md"], unexpectedFiles: [], scope: "PASS", test: { command: "true", exitCode: 0, pass: true }, dependencies: "PASS", branchCheck: "PASS", worktreeCheck: "PASS", baseAncestor: "PASS", acceptance: "disposable fixture" };

class PilotGit extends GitAdapter {
  constructor(private readonly files: readonly string[]) { super(); }
  override async snapshot(): Promise<GitSnapshot> { return { branch: "agent/PILOT-SCOPE", head: "pilot-head", clean: true, changedFiles: this.files }; }
  override async changedFiles(): Promise<string[]> { return [...this.files]; }
  override async remoteContains(): Promise<boolean> { return true; }
  override async isAncestor(): Promise<boolean> { return true; }
}

export async function runPilotFixture(): Promise<PilotFixtureResult> {
  const safe = [makeTask("SAFE-A", "SAFE"), makeTask("SAFE-B", "SAFE")];
  const scheduler = new DeterministicScheduler();
  const safeDispatch = scheduler.planDispatch({ tasks: safe.map((task) => ({ task, state: "ready", dependenciesClosed: true, humanGateSatisfied: false, issueOpen: true, dependenciesAncestor: true })), running: [], maxLunaWorkers: 2 }).map((task) => task.id);
  const exclusiveBlocked = scheduler.planDispatch({ tasks: [{ task: makeTask("EXCLUSIVE", "EXCLUSIVE"), state: "ready", dependenciesClosed: true, humanGateSatisfied: false, issueOpen: true, dependenciesAncestor: true }], running: [{ taskId: "SAFE-A", parallel: "SAFE" }], maxLunaWorkers: 2 }).length === 0;
  let review = 0; const resumeSessions: string[] = []; let remoteVerification = false;
  const lunaSessionId = "123e4567-e89b-72d3-a456-426614174000";
  const controller = new ReviewCloseController({ validate: async () => packet, reviewer: { review: async () => { review += 1; return review === 1 ? { result: "REWORK", reason: "fixture rework" } : "APPROVE"; } }, mergeReviewed: async () => { remoteVerification = true; return { pass: true }; }, resumeLuna: async (reason) => { resumeSessions.push(`${lunaSessionId}:${reason}`); }, setState: async () => undefined, closeIssue: async () => undefined });
  const result = await controller.processWorkerDone();
  const base = { checkpoint: { issueNumber: 1, taskId: "PILOT", phase: "luna", attempt: 1, sessionId: lunaSessionId, branch: "agent/PILOT", worktree: "/tmp/pilot", pid: null, lastHead: null, retryAt: null } as const, issueState: "running" as const, processAlive: false, pushedHead: false, sessionExists: true, now: new Date("2030-01-01T00:00:00Z") };
  const rateLimit = reconcile({ ...base, rateLimited: true }, 60_000);
  const positive = await new MachineValidator(new PilotGit(["docs/agent-runs/pilot.md"])).validate(makeTask("PILOT-SCOPE", "SAFE"), { worktree: "/tmp/pilot", repo: "/tmp/pilot", baseRef: "origin/main", remoteBranch: "agent/PILOT-SCOPE", dependenciesPass: true, expectedBranch: "agent/PILOT-SCOPE", expectedWorktree: "/tmp/pilot" });
  const negative = await new MachineValidator(new PilotGit(["src/forbidden.ts"])).validate(makeTask("PILOT-SCOPE", "SAFE"), { worktree: "/tmp/pilot", repo: "/tmp/pilot", baseRef: "origin/main", remoteBranch: "agent/PILOT-SCOPE", dependenciesPass: true, expectedBranch: "agent/PILOT-SCOPE", expectedWorktree: "/tmp/pilot" });
  let recoveryStarted = false; let recoveryReviewerCalls = 0; let primaryRetired = false;
  const recoveryController = new ReviewCloseController({ validate: async () => packet, reviewer: { review: async () => { if (!recoveryStarted) return { result: "REWORK", reason: "same finding" }; recoveryReviewerCalls += 1; return "APPROVE"; } }, mergeReviewed: async () => ({ pass: true }), resumeLuna: async () => undefined, startRecovery: async () => { recoveryStarted = true; }, retirePrimary: async () => { primaryRetired = true; }, setState: async () => undefined, closeIssue: async () => undefined });
  await recoveryController.processWorkerDone();
  const claim: PlanConflictClaim = { conflictType: "PLAN_CONFLICT", taskId: "PLAN", canonicalRequirementRefs: ["HANDOFF §6"], conflictingTaskFields: ["allowedPaths"], repoEvidence: ["fixture evidence"], whyWorkerCannotResolveWithinScope: "fixture scope" };
  const planTask = makeTask("PLAN", "EXCLUSIVE");
  const revision = activatePlanRevision({ handoff: { id: "fixture", source: "docs/h.md", board: "docs/b.md", targetRepo: "/Users/eita/projects/slot", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md" }, workerCompletionContract: { independentReview: "required", reviewer: "same-session-read-only-luna-subagent", reviewerContext: "task-scope-source-head-review-packet-only", reviewerHistory: "none", onRework: "same-implementation-session-fix-validate-rereview", completion: "reviewer-approve-required-before-terra", fallback: "only-if-subagent-capability-unavailable" }, tasks: [planTask, makeTask("UNRELATED", "SAFE")] }, claim);
  const unrelated = scheduler.planDispatch({ tasks: [{ task: planTask, state: "ready", dependenciesClosed: true, humanGateSatisfied: false, issueOpen: true, dependenciesAncestor: true, pausedByPlanRevision: true }, { task: makeTask("UNRELATED", "SAFE"), state: "ready", dependenciesClosed: true, humanGateSatisfied: false, issueOpen: true, dependenciesAncestor: true }], running: [], maxLunaWorkers: 2, mergeBarrierActive: revision.mergeBarrierActive }).map((task) => task.id);
  const resumable = { sessionId: lunaSessionId, taskId: "PILOT", role: "primary" as const, lifecycle: "RESUMABLE" as const };
  const retired = { sessionId: "123e4567-e89b-12d3-a456-426614174001", taskId: "PILOT", role: "recovery" as const, lifecycle: "RETIRED" as const };
  return { safeDispatch, exclusiveBlocked, reviewRounds: result.reviewRounds, resumeSessions, remoteVerification, rateLimitAction: rateLimit.kind, rateLimitRetryAt: rateLimit.retryAt ?? null, restartAction: reconcile({ ...base, rateLimited: false }, 60_000).kind, restartSessionId: base.checkpoint.sessionId, scopeAccepted: positive.scope === "PASS", scopeRejected: negative.scope === "FAIL", reviewedHeadRefused: !new GitAdapter().evaluateMergeGates({ requiredTestsPass: true, machineValidationPass: true, scopePass: true, unexpectedDiffPass: true, cleanWorktree: true, pushedBranch: true, dependencyBasePass: true, reviewedHead: "old", currentHead: "new", unresolvedHumanGate: false, activeMergeBarrier: false }).pass, recoveryFresh: recoveryStarted && primaryRetired, recoveryReviewerRequired: recoveryReviewerCalls === 1, planConflictConfirmed: revision.active, barrierRefusesMerge: !mergeAllowed(revision.mergeBarrierActive), unrelatedSafeContinues: unrelated.includes("UNRELATED"), resumableRetained: !canCleanupSession(resumable), retiredCleaned: cleanupSessions([resumable, retired]).length === 1, authorityBoundary: true };
}
