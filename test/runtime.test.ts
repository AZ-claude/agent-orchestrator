import assert from "node:assert/strict";
import test from "node:test";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CheckpointStore } from "../src/checkpoint/index.js";
import { parseRuntimeTargetConfig, RuntimeTargetConfig, TaskManifest } from "../src/config/index.js";
import { GitAdapter } from "../src/git/index.js";
import { IssueSnapshot, TASK_MARKER } from "../src/github/index.js";
import { RuntimeComposition, RuntimeIssueBoundary } from "../src/runtime/index.js";
import { DurableWorkerDispatchOptions, DurableWorkerResumeOptions, DurableWorkerRuntime, ImplementationWorkerAdapter, WorkerDispatcher, WorkerDispatchHandle, WorkerDispatchResult, WorkerRunRouter } from "../src/worker/index.js";
import { WorkerProcessHandle } from "../src/worker/worker.js";

const execFile = promisify(nodeExecFile);

const manifest: TaskManifest = {
  version: 2,
  planningAuthority: "Terra",
  handoff: { id: "runtime-fixture", source: "docs/runtime.md", board: "docs/runtime-board.md", targetRepo: "/tmp/placeholder", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md" },
  workerCompletionContract: { independentReview: "required", reviewer: "same-session-read-only-luna-subagent", reviewerContext: "task-scope-source-head-review-packet-only", reviewerHistory: "none", onRework: "same-implementation-session-fix-validate-rereview", completion: "reviewer-approve-required-before-merge", fallback: "only-if-subagent-capability-unavailable" },
  tasks: [{ id: "AO-43", title: "runtime fixture", dependsOn: [], parallel: "EXCLUSIVE", humanGate: false, allowedPaths: ["change.txt"], test: "true", completion: "fixture commit" }],
};

class FakeIssues implements RuntimeIssueBoundary {
  issue: IssueSnapshot = { number: 1, title: "runtime", body: TASK_MARKER("AO-43"), state: "OPEN", labels: ["ao:state:ready"], parentNumber: null, blockedBy: [] };
  readonly calls: string[] = [];
  async readOpen(): Promise<readonly IssueSnapshot[]> { return [this.issue]; }
  async setState(number: number, state: IssueSnapshot["labels"][number] extends never ? never : "ready" | "running" | "paused" | "worker-done" | "reviewing" | "rework" | "blocked-human"): Promise<void> {
    assert.equal(number, 1); this.calls.push(`state:${state}`); this.issue = { ...this.issue, labels: [`ao:state:${state}`] };
  }
  async close(number: number): Promise<void> { assert.equal(number, 1); this.calls.push("close"); this.issue = { ...this.issue, state: "CLOSED" }; }
}

function targetConfig(repo: string): RuntimeTargetConfig {
  return parseRuntimeTargetConfig({ target: "disposable", disposable: { targetRepo: repo, baseBranch: "main", allowedRoots: [tmpdir()] }, pilot: { enabled: false, targetRepo: "/Users/eita/.local/share/agent-orchestrator/targets/pilot", baseBranch: "main", githubRepo: "AZ-claude/agent-orchestrator-pilot" }, production: { enabled: false, targetRepo: "/Users/eita/.local/share/agent-orchestrator/targets/slot", baseBranch: "master", githubRepo: "AZ-claude/slot" } });
}

function fakeWorker(repo: string, counters: { starts: number; resumes: number }): { start: (options: { worktree: string }) => Promise<WorkerDispatchResult>; resume: () => Promise<WorkerDispatchResult>; retire: () => Promise<boolean> } {
  const run = { provider: "cloud" as const, adapter: "codex/luna" as const, role: "primary" as const, sessionId: null, pid: undefined, outcome: "success" as const, exitCode: 0, stderr: [], logPath: "/tmp/runtime.log", fresh: true, resumable: false };
  return {
    start: async (options) => { counters.starts += 1; await writeFile(join(options.worktree, "change.txt"), "fixture\n"); await execFile("git", ["add", "change.txt"], { cwd: options.worktree }); await execFile("git", ["commit", "-m", "fixture"], { cwd: options.worktree }); await execFile("git", ["push", "-u", "origin", "agent/AO-43"], { cwd: options.worktree }); return { run, routing: { mode: "cloud", configuredPrimary: "cloud", configuredRecovery: "cloud", latchedProvider: null } }; },
    resume: async () => { counters.resumes += 1; return { run, routing: { mode: "cloud", configuredPrimary: "cloud", configuredRecovery: "cloud", latchedProvider: null } }; },
    retire: async () => false,
  };
}

async function fixture(): Promise<{ repo: string; remote: string; state: string }> {
  const repo = await mkdtemp(join(tmpdir(), "ao-runtime-repo-"));
  const remote = await mkdtemp(join(tmpdir(), "ao-runtime-remote-"));
  const state = await mkdtemp(join(tmpdir(), "ao-runtime-state-"));
  await execFile("git", ["init", "-b", "main"], { cwd: repo });
  await execFile("git", ["config", "user.email", "ao@example.test"], { cwd: repo });
  await execFile("git", ["config", "user.name", "Agent Orchestrator"], { cwd: repo });
  await writeFile(join(repo, "README.md"), "base\n"); await execFile("git", ["add", "README.md"], { cwd: repo }); await execFile("git", ["commit", "-m", "base"], { cwd: repo });
  await execFile("git", ["init", "--bare", remote]); await execFile("git", ["remote", "add", "origin", remote], { cwd: repo }); await execFile("git", ["push", "-u", "origin", "main"], { cwd: repo });
  return { repo, remote, state };
}

test("AO-44/45 composes one disposable task from dispatch through reviewed merge and cleanup", async () => {
  const { repo, state } = await fixture();
  const runtimeManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo } };
  const issues = new FakeIssues(); const counters = { starts: 0, resumes: 0 };
  const runtime = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, workers: fakeWorker(repo, counters) as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000 });
  assert.equal((await runtime.poll()).kind, "dispatched");
  assert.equal(await (new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, workers: fakeWorker(repo, counters) as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000 })).poll().then((result) => result.kind), "completed");
  assert.equal(counters.starts, 1); assert.equal(issues.issue.state, "CLOSED");
  assert.equal(await readFile(join(repo, "change.txt"), "utf8"), "fixture\n");
  const checkpoint = await new CheckpointStore(state).load("AO-43");
  assert.equal(checkpoint?.lifecycle, "CLEANUP"); assert.equal(checkpoint?.review?.result, "APPROVE");
  assert.equal((await runtime.poll()).action, "skip-completed"); assert.equal(counters.starts, 1);
});

test("AO-46 resumes from the reviewed-before-merge checkpoint without re-review or redispatch", async () => {
  const { repo, state } = await fixture();
  const runtimeManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo } };
  const issues = new FakeIssues(); issues.issue = { ...issues.issue, labels: ["ao:state:reviewing"] };
  const git = new GitAdapter(); const info = await git.prepareWorktree(repo, "AO-43", state, "main");
  await writeFile(join(info.path, "change.txt"), "reviewed\n"); await execFile("git", ["add", "change.txt"], { cwd: info.path }); await execFile("git", ["commit", "-m", "reviewed"], { cwd: info.path }); await execFile("git", ["push", "-u", "origin", "agent/AO-43"], { cwd: info.path });
  const head = await git.head(info.path); const checkpoints = new CheckpointStore(state);
  await checkpoints.save({ issueNumber: 1, taskId: "AO-43", phase: "luna", attempt: 1, sessionId: null, branch: info.branch, worktree: info.path, pid: null, lastHead: head, retryAt: null, executionState: "reviewing", lifecycle: "RETIRED", workerRole: "primary", review: { result: "APPROVE", cycle: 1 }, reviewedHead: head });
  let reviews = 0; const counters = { starts: 0, resumes: 0 };
  const result = await new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, git, workers: fakeWorker(repo, counters) as never, reviewer: { review: async () => { reviews += 1; return "APPROVE"; } }, retryIntervalMs: 1000 }).poll();
  assert.equal(result.kind, "completed"); assert.equal(reviews, 0); assert.equal(counters.starts, 0); assert.equal(issues.issue.state, "CLOSED");
});

test("AO-46 restart observations are checkpoint-driven and do not duplicate a running task", async () => {
  const { repo, state } = await fixture();
  const runtimeManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo } };
  const issues = new FakeIssues(); const counters = { starts: 0, resumes: 0 }; const checkpoints = new CheckpointStore(state);
  const base = { issueNumber: 1, taskId: "AO-43", phase: "luna" as const, attempt: 1, sessionId: "session-1", branch: "agent/AO-43", worktree: join(state, "worktrees/AO-43"), pid: 42, lastHead: "head", retryAt: null, executionState: "running" as const };
  await checkpoints.save(base);
  const runtime = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, workers: fakeWorker(repo, counters) as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000, isProcessAlive: () => true, sessionExists: async () => true });
  assert.deepEqual(await runtime.poll(), { kind: "watching", taskId: "AO-43", action: "watch" }); assert.equal(counters.starts, 0);
});

test("AO-53 fails closed when a reviewed source HEAD changes before restart merge", async () => {
  const { repo, state } = await fixture();
  const runtimeManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo } };
  const issues = new FakeIssues(); issues.issue = { ...issues.issue, labels: ["ao:state:reviewing"] };
  const git = new GitAdapter(); const info = await git.prepareWorktree(repo, "AO-43", state, "main");
  await writeFile(join(info.path, "change.txt"), "reviewed\n"); await execFile("git", ["add", "change.txt"], { cwd: info.path }); await execFile("git", ["commit", "-m", "reviewed"], { cwd: info.path }); await execFile("git", ["push", "-u", "origin", "agent/AO-43"], { cwd: info.path });
  const reviewedHead = await git.head(info.path);
  await writeFile(join(info.path, "change.txt"), "changed-after-review\n"); await execFile("git", ["add", "change.txt"], { cwd: info.path }); await execFile("git", ["commit", "-m", "changed-after-review"], { cwd: info.path }); await execFile("git", ["push", "origin", "agent/AO-43"], { cwd: info.path });
  const checkpoints = new CheckpointStore(state);
  await checkpoints.save({ issueNumber: 1, taskId: "AO-43", phase: "luna", attempt: 1, sessionId: null, branch: info.branch, worktree: info.path, pid: null, lastHead: reviewedHead, retryAt: null, executionState: "reviewing", lifecycle: "RETIRED", workerRole: "primary", review: { result: "APPROVE", cycle: 1 }, reviewedHead });
  const result = await new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, git, workers: fakeWorker(repo, { starts: 0, resumes: 0 }) as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000 }).poll();
  assert.equal(result.kind, "blocked-human"); assert.equal(issues.issue.state, "OPEN"); assert.ok(issues.calls.includes("state:blocked-human"));
});

test("detached runtime dispatch fills two SAFE slots with distinct durable process ownership", async () => {
  const { repo, state } = await fixture();
  const fixtureTask = manifest.tasks[0]!;
  const runtimeManifest: TaskManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo }, tasks: [
    { ...fixtureTask, id: "AO-43-A", parallel: "SAFE", allowedPaths: ["a.txt"] },
    { ...fixtureTask, id: "AO-43-B", parallel: "SAFE", allowedPaths: ["b.txt"] },
  ] };
  let issues: IssueSnapshot[] = [
    { number: 1, title: "A", body: TASK_MARKER("AO-43-A"), state: "OPEN", labels: ["ao:state:ready"], parentNumber: null, blockedBy: [] },
    { number: 2, title: "B", body: TASK_MARKER("AO-43-B"), state: "OPEN", labels: ["ao:state:ready"], parentNumber: null, blockedBy: [] },
  ];
  const checkpoints = new CheckpointStore(state);
  const active = new Set<number>();
  const handles = new Map<string, WorkerDispatchHandle>();
  const workers = {
    start: async () => { throw new Error("legacy blocking start must not be used"); },
    startDetached: async (options: { checkpoint: Parameters<typeof checkpoints.save>[0]; worktree: string }): Promise<WorkerDispatchHandle> => {
      const pid = 700 + handles.size + 1;
      active.add(pid);
      const run = { provider: "cloud" as const, adapter: "codex/luna" as const, role: "primary" as const, sessionId: null, pid, outcome: "success" as const, exitCode: 0, stderr: [], logPath: `/tmp/${pid}.log`, fresh: true, resumable: false };
      const routing = { mode: "cloud" as const, configuredPrimary: "cloud" as const, configuredRecovery: "cloud" as const, latchedProvider: null };
      const process: WorkerProcessHandle = { started: { provider: "cloud", adapter: "codex/luna", role: "primary", sessionId: null, pid, logPath: run.logPath, fresh: true, resumable: false }, completion: new Promise(() => undefined) };
      await checkpoints.save({ ...options.checkpoint, pid, workerProvider: "cloud", workerAdapter: "codex/luna", workerMode: "cloud", configuredPrimary: "cloud", configuredRecovery: "cloud", lifecycle: "ACTIVE", executionState: "running" });
      const handle = { started: process.started, routing, completion: process.completion.then((value) => ({ run: value, routing })) };
      handles.set(options.checkpoint.taskId, handle);
      return handle;
    },
    resume: async () => { throw new Error("resume not expected"); },
    retire: async () => false,
  };
  const issueBoundary: RuntimeIssueBoundary = {
    readOpen: async () => issues,
    setState: async (number, stateValue) => { issues = issues.map((issue) => issue.number === number ? { ...issue, labels: [`ao:state:${stateValue}`] } : issue); },
    close: async () => undefined,
  };
  const runtime = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, checkpoints, issues: issueBoundary, workers: workers as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000, maxLunaWorkers: 2, isProcessAlive: (pid) => active.has(pid) });
  assert.equal((await runtime.poll()).kind, "dispatched");
  assert.equal((await runtime.poll()).kind, "dispatched");
  const saved = await checkpoints.list();
  assert.equal(saved.length, 2);
  assert.equal(new Set(saved.map((checkpoint) => checkpoint.pid)).size, 2);
  assert.equal(new Set(saved.map((checkpoint) => checkpoint.worktree)).size, 2);
  assert.equal(new Set(saved.map((checkpoint) => checkpoint.branch)).size, 2);
});

test("A: restart discovers a detached worker commit/push from Git without completion callback or duplicate dispatch", async () => {
  const { repo, state } = await fixture();
  const runtimeManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo } };
  const issues = new FakeIssues();
  const checkpoints = new CheckpointStore(state);
  let starts = 0;
  const routing = { mode: "cloud" as const, configuredPrimary: "cloud" as const, configuredRecovery: "cloud" as const, latchedProvider: null };
  const workers = {
    start: async (_options: DurableWorkerDispatchOptions): Promise<WorkerDispatchResult> => { throw new Error("unexpected blocking dispatch"); },
    startDetached: async (options: DurableWorkerDispatchOptions): Promise<WorkerDispatchHandle> => {
      starts += 1;
      await checkpoints.save({ ...options.checkpoint, pid: 701, workerProvider: "cloud", workerAdapter: "codex/luna", workerMode: "cloud", configuredPrimary: "cloud", configuredRecovery: "cloud", lifecycle: "ACTIVE", executionState: "running" });
      return {
        started: { provider: "cloud", adapter: "codex/luna", role: "primary", sessionId: null, pid: 701, logPath: "/tmp/a.log", fresh: true, resumable: false },
        routing,
        completion: new Promise<WorkerDispatchResult>(() => undefined),
      };
    },
    resume: async (_options: DurableWorkerResumeOptions): Promise<WorkerDispatchResult> => { throw new Error("unexpected resume"); },
    retire: async (_pid?: number): Promise<boolean> => false,
  };
  const firstRuntime = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, workers: workers as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000, isProcessAlive: () => true });
  assert.equal((await firstRuntime.poll()).kind, "dispatched");

  const checkpoint = await checkpoints.load("AO-43");
  assert.ok(checkpoint);
  await writeFile(join(checkpoint.worktree, "change.txt"), "restart-completed\n");
  await execFile("git", ["add", "change.txt"], { cwd: checkpoint.worktree });
  await execFile("git", ["commit", "-m", "restart completion"], { cwd: checkpoint.worktree });
  await execFile("git", ["push", "-u", "origin", checkpoint.branch], { cwd: checkpoint.worktree });

  const restarted = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, workers: workers as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000, isProcessAlive: () => false });
  const result = await restarted.poll();
  assert.equal(result.kind, "completed");
  assert.equal(starts, 1);
  assert.equal(issues.issue.state, "CLOSED");
  assert.equal((await checkpoints.load("AO-43"))?.lifecycle, "CLEANUP");
});

test("B/C: fallback transition is durable while Local runs and completion is recovered after restart", async () => {
  const { repo, state } = await fixture();
  const runtimeManifest = { ...manifest, handoff: { ...manifest.handoff, targetRepo: repo } };
  const issues = new FakeIssues();
  const checkpoints = new CheckpointStore(state);
  const localModel = "ollama/qwen3.8:latest";
  let starts = 0;
  let localStarts = 0;
  let cloudResolve!: (run: { provider: "cloud"; adapter: "codex/luna"; role: "primary"; sessionId: null; pid: number; outcome: "availability-limit"; availabilityReason: "QUOTA_LIMIT"; exitCode: number; stderr: never[]; logPath: string; fresh: true; resumable: false }) => void;
  const cloudCompletion = new Promise<Parameters<typeof cloudResolve>[0]>((resolve) => { cloudResolve = resolve; });
  const localCompletion = new Promise<never>(() => undefined);
  const cloud: ImplementationWorkerAdapter = {
    provider: "cloud",
    start: async () => { throw new Error("unexpected blocking cloud dispatch"); },
    startDetached: async (_prompt, _worktree, role) => ({ started: { provider: "cloud", adapter: "codex/luna", role, sessionId: null, pid: 711, logPath: "/tmp/cloud.log", fresh: true, resumable: false }, completion: cloudCompletion }),
    resume: async () => { throw new Error("unexpected cloud resume"); },
    startRecovery: async () => { throw new Error("unexpected cloud recovery"); },
    retire: async () => false,
  };
  const local: ImplementationWorkerAdapter = {
    provider: "local",
    start: async () => { throw new Error("unexpected blocking local dispatch"); },
    startDetached: async (_prompt, _worktree, role) => { localStarts += 1; return { started: { provider: "local", adapter: "opencode", role, sessionId: "local-session", pid: 712, logPath: "/tmp/local.log", fresh: true, resumable: false, lease: { status: "acquired" as const, owner: "agent-orchestrator" as const, model: localModel, pid: 712 } }, completion: localCompletion }; },
    resume: async () => { throw new Error("unexpected local resume"); },
    startRecovery: async () => { throw new Error("unexpected local recovery"); },
    retire: async () => false,
  };
  const dispatcher = new WorkerDispatcher(new WorkerRunRouter({ mode: "auto", primary: "cloud", recovery: "local", local: { executable: "/tmp/opencode", model: localModel, contextTokens: 262144, workdir: "/tmp", ollamaBaseUrl: "http://127.0.0.1:11434", configPath: "/tmp/config", leasePath: join(state, "lease") } }), { cloud, local }, async () => true);
  const durable = new DurableWorkerRuntime(dispatcher, checkpoints);
  const info = await new GitAdapter().prepareWorktree(repo, "AO-43", state, "main");
  const base = { issueNumber: 1, taskId: "AO-43", phase: "luna" as const, attempt: 1, sessionId: null, branch: info.branch, worktree: info.path, pid: null, lastHead: null, retryAt: null, executionState: "running" as const };
  const oldHandle = await durable.startDetached({ checkpoint: base, prompt: "task", worktree: info.path, runId: "AO-43-1", localModel });
  assert.equal(oldHandle.started.provider, "cloud");
  let completionError: unknown;
  void oldHandle.completion.catch((error: unknown) => { completionError = error; });
  cloudResolve({ provider: "cloud", adapter: "codex/luna", role: "primary", sessionId: null, pid: 711, outcome: "availability-limit", availabilityReason: "QUOTA_LIMIT", exitCode: 1, stderr: [], logPath: "/tmp/cloud.log", fresh: true, resumable: false });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await checkpoints.load("AO-43"))?.workerProvider === "local") break;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  const fallbackCheckpoint = await checkpoints.load("AO-43");
  assert.equal(localStarts, 1);
  if (fallbackCheckpoint?.workerProvider !== "local" && completionError !== undefined) throw completionError;
  assert.equal(fallbackCheckpoint?.workerProvider, "local");
  assert.equal(fallbackCheckpoint?.pid, 712);
  assert.deepEqual(fallbackCheckpoint?.providerFallback, { from: "cloud", to: "local", reason: "QUOTA_LIMIT", latched: true });
  assert.deepEqual(fallbackCheckpoint?.localLease, { status: "acquired", owner: "agent-orchestrator", model: localModel, pid: 712 });

  const regeneratedWhileLocalRuns = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, workers: { start: async () => { starts += 1; throw new Error("running local fallback must not redispatch"); }, resume: async () => { throw new Error("running local fallback must not resume"); }, retire: async () => false } as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000, isProcessAlive: (pid) => pid === 712 });
  assert.deepEqual(await regeneratedWhileLocalRuns.poll(), { kind: "watching", taskId: "AO-43", action: "watch" });
  assert.equal(starts, 0);

  await writeFile(join(info.path, "change.txt"), "local restart completion\n");
  await execFile("git", ["add", "change.txt"], { cwd: info.path });
  await execFile("git", ["commit", "-m", "local restart completion"], { cwd: info.path });
  await execFile("git", ["push", "-u", "origin", info.branch], { cwd: info.path });
  const restarted = new RuntimeComposition({ target: targetConfig(repo), manifest: runtimeManifest, stateRoot: state, issues, checkpoints, workers: { start: async () => { starts += 1; throw new Error("fallback must not redispatch"); }, resume: async () => { throw new Error("fallback must not resume"); }, retire: async () => false } as never, reviewer: { review: async () => "APPROVE" }, retryIntervalMs: 1000, isProcessAlive: () => false });
  const result = await restarted.poll();
  assert.equal(result.kind, "completed");
  assert.equal(starts, 0);
  assert.equal(issues.issue.state, "CLOSED");
  void oldHandle;
});
