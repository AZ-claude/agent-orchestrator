import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { CheckpointStore } from "../checkpoint/index.js";
import { Checkpoint, parseManifest, parsePilotConfig, PILOT_TARGET_REPO, PilotConfig, TaskManifest } from "../config/index.js";
import { CliGhClient, GhClient, GitHubIssueProjector } from "../github/index.js";
import { reconcile } from "../reconcile/index.js";
import { DeterministicScheduler, schedulerTasks } from "../scheduler/index.js";
import { CliOperations } from "./cli.js";
import { PrivacySafeLogger } from "../logging/index.js";
import { preflightLocalWorker } from "../opencode/index.js";

export interface CliAppOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly gh?: GhClient;
  readonly logger?: PrivacySafeLogger;
}

export interface LoadedRuntime {
  readonly root: string;
  readonly config: PilotConfig;
  readonly manifest: TaskManifest;
  readonly checkpoints: readonly Checkpoint[];
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
    const manifest = parseManifest(await parseDocument(await readFile(manifestPath, "utf8"), manifestPath));
    if (manifest.version !== 2 || !SUPPORTED_DELTA_MANIFEST_IDS.has(manifest.handoff.id)) throw new Error("entrypoint requires a supported canonical version 2 pre-install delta manifest");
    const checkpoints = await new CheckpointStore(config.stateRoot).list();
    return { root, config, manifest, checkpoints };
  };

  return {
    bootstrap: async () => {
      const runtime = await load();
      await new GitHubIssueProjector(gh).project(runtime.manifest);
      logger.info("bootstrap_complete", { manifest: runtime.manifest.handoff.id });
    },
    runOnce: async () => {
      const runtime = await load();
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

export async function loadRuntime(options: CliAppOptions = {}): Promise<LoadedRuntime> {
  // Status is the side-effect-free composition probe and returns through the
  // same canonical loader used by every command.
  const cwd = resolve(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const configPath = requiredAbsoluteEnv(env, "AO_CONFIG_PATH");
  const config = parsePilotConfig(parseDocument(await readFile(configPath, "utf8"), configPath));
  const manifestPath = resolve(cwd, config.pilot.manifestPath);
  const manifest = parseManifest(await parseDocument(await readFile(manifestPath, "utf8"), manifestPath));
  if (manifest.version !== 2 || !SUPPORTED_DELTA_MANIFEST_IDS.has(manifest.handoff.id)) throw new Error("entrypoint requires a supported canonical version 2 pre-install delta manifest");
  return { root: cwd, config, manifest, checkpoints: await new CheckpointStore(config.stateRoot).list() };
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
