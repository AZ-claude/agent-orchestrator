import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CheckpointStore } from "../checkpoint/index.js";
import { Checkpoint, parseManifest, parseManifestForTarget, parsePilotConfig, PILOT_TARGET_REPO, PilotConfig, TaskManifest } from "../config/index.js";
import { CliGhClient, GhClient, GitHubIssueProjector, TargetAwareGhClient } from "../github/index.js";
import { reconcile } from "../reconcile/index.js";
import { DeterministicScheduler, schedulerTasks } from "../scheduler/index.js";
import { CliOperations } from "./cli.js";
import { PrivacySafeLogger } from "../logging/index.js";
import { preflightLocalWorker } from "../opencode/index.js";
import { RuntimeComposition, createRuntimeIssueBoundary } from "../runtime/index.js";
import { assertDisposableRuntimeTarget, AO_LOCAL_MODEL, REQUIRED_LOCAL_CONTEXT } from "../config/index.js";
import { GitAdapter, defaultCommandRunner } from "../git/index.js";
import { CloudWorkerAdapter } from "../worker/cloud.js";
import { DurableWorkerRuntime, WorkerDispatcher, WorkerRunRouter } from "../worker/index.js";
import { LunaRunner } from "../luna/index.js";
import { OpenCodeWorkerAdapter } from "../opencode/index.js";
import { codexSessionExists } from "../codex/index.js";
import { CodexReadOnlyReviewer } from "../controller/index.js";

export interface CliAppOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly gh?: GhClient;
  readonly logger?: PrivacySafeLogger;
  /** Test-only composition override; production uses the concrete factory below. */
  readonly runtimeFactory?: (runtime: LoadedRuntime) => RuntimeComposition;
}

export interface LoadedRuntime {
  readonly root: string;
  readonly config: PilotConfig;
  readonly manifest: TaskManifest;
  readonly checkpoints: readonly Checkpoint[];
  readonly runtimeTarget?: PilotConfig["runtime"];
}

const SUPPORTED_DELTA_MANIFEST_IDS = new Set(["agent-orchestrator-preinstall-delta", "agent-orchestrator-qwen-opencode-worker-preinstall-delta"]);

/**
 * The concrete daemon composition. It deliberately performs only file reads,
 * deterministic scheduling/reconciliation, or the explicit bootstrap Issue
 * projection for each command; no module import starts work or an LLM.
 */
export function createCliOperations(options: CliAppOptions = {}): CliOperations {
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const logger = options.logger ?? new PrivacySafeLogger();
  const gh = options.gh ?? new CliGhClient();

  const load = async (): Promise<LoadedRuntime> => {
    const root = resolve(cwd);
    const configPath = requiredAbsoluteEnv(env, "AO_CONFIG_PATH");
    const config = parsePilotConfig(parseDocument(await readFile(configPath, "utf8"), configPath));
    if (config.pilot.targetRepo !== PILOT_TARGET_REPO) throw new Error(`configured pilot target must equal ${PILOT_TARGET_REPO}`);
    const manifestPath = resolve(root, config.pilot.manifestPath);
    if (!isWithin(root, manifestPath)) throw new Error("manifest path must remain inside the repository");
    const manifest = config.runtime
      ? parseManifestForTarget(await parseDocument(await readFile(manifestPath, "utf8"), manifestPath), config.runtime.disposable.targetRepo)
      : parseManifest(await parseDocument(await readFile(manifestPath, "utf8"), manifestPath));
    const supported = config.runtime ? manifest.version === 2 && manifest.handoff.id === "agent-orchestrator-runtime-composition" : manifest.version === 2 && SUPPORTED_DELTA_MANIFEST_IDS.has(manifest.handoff.id);
    if (!supported) throw new Error("entrypoint requires a supported canonical version 2 manifest");
    const checkpoints = await new CheckpointStore(config.stateRoot).list();
    return { root, config, manifest, checkpoints, ...(config.runtime === undefined ? {} : { runtimeTarget: config.runtime }) };
  };

  return {
    bootstrap: async () => {
      const runtime = await load();
      const targetRepository = runtime.config.runtime === undefined ? undefined : requiredTargetRepository(runtime.config.runtime.disposable.githubRepo);
      if (runtime.config.runtime !== undefined) assertDisposableRuntimeTarget(runtime.config.runtime);
      const targetGh = runtime.config.runtime === undefined
        ? gh
        : options.gh === undefined
          ? new TargetAwareGhClient(defaultCommandRunner, requiredTargetRepository(targetRepository))
          : requireTargetAwareGh(options.gh, requiredTargetRepository(targetRepository));
      if (runtime.config.runtime !== undefined) await requireTargetAwareGh(targetGh, requiredTargetRepository(targetRepository)).verifyTarget(runtime.config.runtime.disposable.targetRepo);
      await new GitHubIssueProjector(targetGh).project(runtime.manifest);
      logger.info("bootstrap_complete", { manifest: runtime.manifest.handoff.id });
    },
    runOnce: async () => {
      const runtime = await load();
      if (runtime.config.runtime !== undefined) {
        const target = assertDisposableRuntimeTarget(runtime.config.runtime);
        const configuredRepo = requiredTargetRepository(target.githubRepo);
        const targetGh = options.gh === undefined ? new TargetAwareGhClient(defaultCommandRunner, configuredRepo) : requireTargetAwareGh(options.gh, configuredRepo);
        await targetGh.verifyTarget(target.targetRepo);
        const result = await (options.runtimeFactory?.(runtime) ?? createConcreteRuntime(runtime, targetGh)).poll();
        logger.info("run_once_complete", { kind: result.kind, ...(result.taskId === undefined ? {} : { taskId: result.taskId }) });
        return;
      }
      const issues = await new GitHubIssueProjector(gh).readOpen();
      const issueByTask = new Map(runtime.manifest.tasks.map((task) => [task.id, issues.find((issue) => issue.body.includes(`agent-orchestrator:task=${task.id}`))]));
      const states = new Map(runtime.checkpoints.map((checkpoint) => [checkpoint.taskId, checkpoint.phase === "luna" ? "running" as const : "reviewing" as const]));
      const closed = new Set([...issueByTask.entries()].filter(([, issue]) => issue?.state === "CLOSED").map(([taskId]) => taskId));
      const open = new Set([...issueByTask.entries()].filter(([, issue]) => issue?.state === "OPEN").map(([taskId]) => taskId));
      const ancestorEvidence = new Set(runtime.manifest.tasks.filter((task) => task.dependsOn.length === 0).map((task) => task.id));
      const tasks = schedulerTasks(runtime.manifest, states, closed, new Set(), open, ancestorEvidence);
      const ready = new DeterministicScheduler().planDispatch({ tasks, running: [], maxLunaWorkers: runtime.config.maxLunaWorkers });
      logger.info("run_once_complete", { readyTaskCount: ready.length, workerDispatch: "not-started-by-poll" });
    },
    reconcile: async () => {
      const runtime = await load();
      const actions = runtime.checkpoints.map((checkpoint) => reconcile({ checkpoint, issueState: "running", processAlive: false, pushedHead: false, sessionExists: false, rateLimited: false, now: new Date() }, runtime.config.retryIntervalMs));
      logger.info("reconcile_complete", { checkpointCount: runtime.checkpoints.length, actionCount: actions.length });
    },
    status: async () => {
      const runtime = await load();
      logger.info("status", { manifest: runtime.manifest.handoff.id, version: runtime.manifest.version, checkpointCount: runtime.checkpoints.length, targetRepo: runtime.config.pilot.targetRepo });
    },
    preflight: async () => {
      const runtime = await load();
      const local = runtime.config.worker?.local;
      if (local === undefined) throw new Error("local worker is not configured; preflight is fail-closed");
      const result = await preflightLocalWorker(local);
      logger.info("local_preflight", { provider: result.provider, model: result.model, contextTokens: result.contextTokens, pass: result.pass, checks: result.checks });
      if (!result.pass) throw new Error("local worker preflight failed");
    },
  };
}

/** Build every runtime dependency from the selected, explicitly named target. */
export function createConcreteRuntime(runtime: LoadedRuntime, injectedGh?: GhClient): RuntimeComposition {
  const targetConfig = runtime.config.runtime;
  if (targetConfig === undefined) throw new Error("runtime target configuration is required");
  const target = assertDisposableRuntimeTarget(targetConfig);
  const repository = target.githubRepo;
  if (repository === undefined) throw new Error("disposable runtime target must explicitly declare githubRepo");
  const gh = injectedGh === undefined ? new TargetAwareGhClient(defaultCommandRunner, repository) : requireTargetAwareGh(injectedGh, repository);
  const router = new WorkerRunRouter(runtime.config.worker);
  const cloud = new CloudWorkerAdapter(new LunaRunner(undefined, { maxResumeAttempts: runtime.config.maxResumeAttempts }));
  const localConfig = runtime.config.worker?.local;
  const localPreflight = async () => localConfig !== undefined && (await preflightLocalWorker(localConfig)).pass;
  const local = new OpenCodeWorkerAdapter(undefined, {
    executable: localConfig?.executable ?? "opencode",
    model: localConfig?.model ?? AO_LOCAL_MODEL,
    contextTokens: localConfig?.contextTokens ?? REQUIRED_LOCAL_CONTEXT,
    leasePath: localConfig?.leasePath ?? `${runtime.config.stateRoot}/local-inference-lease`,
    preflight: localPreflight,
  });
  const checkpoints = new CheckpointStore(runtime.config.stateRoot);
  const git = new GitAdapter();
  const workers = new DurableWorkerRuntime(new WorkerDispatcher(router, { cloud, local }, localPreflight), checkpoints);
  const reviewer = new CodexReadOnlyReviewer();
  return new RuntimeComposition({
    target: targetConfig,
    manifest: runtime.manifest,
    stateRoot: runtime.config.stateRoot,
    issues: createRuntimeIssueBoundary(gh, target.targetRepo),
    checkpoints,
    git,
    workers,
    reviewer,
    sessionExists: codexSessionExists,
    maxLunaWorkers: runtime.config.maxLunaWorkers,
    humanGateApproved: (taskId) => runtime.config.humanGateApprovals?.includes(taskId) ?? false,
    retryIntervalMs: runtime.config.retryIntervalMs,
  });
}

function requireTargetAwareGh(client: GhClient, repository: string): TargetAwareGhClient {
  if (!("verifyTarget" in client) || typeof client.verifyTarget !== "function") throw new Error("runtime GitHub client must provide target verification");
  if (!("repository" in client) || client.repository !== repository) throw new Error("runtime GitHub client repository does not match configured target");
  return client as TargetAwareGhClient;
}

function requiredTargetRepository(repository: string | undefined): string {
  if (repository === undefined) throw new Error("disposable runtime target must explicitly declare githubRepo");
  return repository;
}

export async function loadRuntime(options: CliAppOptions = {}): Promise<LoadedRuntime> {
  // Status is the side-effect-free composition probe and returns through the
  // same canonical loader used by every command.
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const configPath = requiredAbsoluteEnv(env, "AO_CONFIG_PATH");
  const config = parsePilotConfig(parseDocument(await readFile(configPath, "utf8"), configPath));
  const manifestPath = resolve(cwd, config.pilot.manifestPath);
  const manifest = config.runtime
    ? parseManifestForTarget(await parseDocument(await readFile(manifestPath, "utf8"), manifestPath), config.runtime.disposable.targetRepo)
    : parseManifest(await parseDocument(await readFile(manifestPath, "utf8"), manifestPath));
  const supported = config.runtime ? manifest.version === 2 && manifest.handoff.id === "agent-orchestrator-runtime-composition" : manifest.version === 2 && SUPPORTED_DELTA_MANIFEST_IDS.has(manifest.handoff.id);
  if (!supported) throw new Error("entrypoint requires a supported canonical version 2 manifest");
  return { root: cwd, config, manifest, checkpoints: await new CheckpointStore(config.stateRoot).list(), ...(config.runtime === undefined ? {} : { runtimeTarget: config.runtime }) };
}

function parseDocument(source: string, path: string): unknown {
  try { return parseYaml(source); } catch (error) { throw new Error(`invalid configuration/manifest YAML at ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function requiredAbsoluteEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "" || !isAbsolute(value)) throw new Error(`${name} must be an existing absolute path`);
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = candidate === root ? "" : candidate.startsWith(`${root}/`) ? candidate.slice(root.length + 1) : "outside";
  return relative !== "outside" && !relative.split("/").includes("..");
}
