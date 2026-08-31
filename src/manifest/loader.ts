import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { ManifestTask, PilotConfig, TaskManifest, parseManifestForPilot, SchemaValidationError } from "../config/index.js";

export class ManifestGraphError extends Error {
  readonly issues: readonly { path: string; message: string }[];
  constructor(issues: readonly { path: string; message: string }[]) {
    super(`manifest graph validation failed: ${issues.map((item) => `${item.path} ${item.message}`).join("; ")}`);
    this.name = "ManifestGraphError";
    this.issues = issues;
  }
}

export interface ManifestLoaderOptions {
  readonly config?: { readonly pilot: Pick<PilotConfig["pilot"], "targetRepo"> };
  readonly expectedTargetRepo?: string;
}

export async function loadManifest(path: string, options: ManifestLoaderOptions = {}): Promise<TaskManifest> {
  const source = await readFile(path, "utf8");
  return parseManifestText(source, options);
}

export function parseManifestText(source: string, options: ManifestLoaderOptions = {}): TaskManifest {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new SchemaValidationError("task manifest", [{ path: "$", message: `invalid YAML: ${error instanceof Error ? error.message : String(error)}` }]);
  }
  const parsed = options.config !== undefined
    ? parseManifestForPilot(raw, options.config)
    : parseManifestForTarget(raw, options.expectedTargetRepo);
  validateManifestGraph(parsed);
  return parsed;
}

export function validateManifestGraph(manifest: TaskManifest): void {
  const issues: { path: string; message: string }[] = [];
  const ids = new Set<string>();
  for (const [index, task] of manifest.tasks.entries()) {
    if (ids.has(task.id)) issues.push({ path: `$.tasks[${index}].id`, message: `duplicate task ID ${task.id}` });
    ids.add(task.id);
  }
  for (const [index, task] of manifest.tasks.entries()) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) issues.push({ path: `$.tasks[${index}].dependsOn`, message: `unknown dependency ${dependency}` });
      if (dependency === task.id) issues.push({ path: `$.tasks[${index}].dependsOn`, message: "task cannot depend on itself" });
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(manifest.tasks.map((task) => [task.id, task]));
  const visit = (task: ManifestTask, path: string): void => {
    if (visiting.has(task.id)) {
      issues.push({ path, message: `dependency cycle includes ${task.id}` });
      return;
    }
    if (visited.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependsOn) {
      const parent = byId.get(dependency);
      if (parent !== undefined) visit(parent, `${path} -> ${dependency}`);
    }
    visiting.delete(task.id);
    visited.add(task.id);
  };
  for (const task of manifest.tasks) visit(task, task.id);
  if (issues.length > 0) throw new ManifestGraphError(issues);
}

export function taskMap(manifest: TaskManifest): ReadonlyMap<string, ManifestTask> {
  return new Map(manifest.tasks.map((task) => [task.id, task]));
}

function parseManifestForTarget(raw: unknown, expectedTargetRepo?: string): TaskManifest {
  if (expectedTargetRepo === undefined) return parseManifestForPilotTarget(raw);
  return parseManifestForPilot(raw, { pilot: { targetRepo: expectedTargetRepo } });
}

function parseManifestForPilotTarget(raw: unknown): TaskManifest {
  // parseManifest's fixed target guard is intentional: v1 has one pilot repo.
  return parseManifestForPilot(raw, { pilot: { targetRepo: "/Users/eita/projects/slot" } });
}
