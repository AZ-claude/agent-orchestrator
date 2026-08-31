import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";

import {
  parseManifest as parseManifestShape,
  SchemaValidationError,
} from "../config/schema.js";
import type { TaskManifest } from "../config/schema.js";
import { parseManifestYaml } from "./yaml.js";

export function parseManifest(source: string, filePath?: string): TaskManifest {
  const manifest = parseManifestShape(parseManifestYaml(source));
  return validateManifestDag(manifest, filePath);
}

export async function loadManifest(filePath: string): Promise<TaskManifest> {
  return parseManifest(await readFile(filePath, "utf8"), filePath);
}

export function loadManifestSync(filePath: string): TaskManifest {
  return parseManifest(readFileSync(filePath, "utf8"), filePath);
}

export function validateManifestDag(manifest: TaskManifest, filePath?: string): TaskManifest {
  const issues: { readonly path: string; readonly message: string }[] = [];
  const taskIndexes = new Map<string, number>();
  for (const [index, task] of manifest.tasks.entries()) {
    const previousIndex = taskIndexes.get(task.id);
    if (previousIndex !== undefined) {
      issues.push({ path: `$.tasks[${index}].id`, message: `duplicate task id ${task.id} (already declared at index ${previousIndex})` });
    } else {
      taskIndexes.set(task.id, index);
    }
  }

  for (const [index, task] of manifest.tasks.entries()) {
    const dependencyIndexes = new Set<string>();
    for (const [dependencyIndex, dependency] of task.dependsOn.entries()) {
      if (!taskIndexes.has(dependency)) {
        issues.push({ path: `$.tasks[${index}].dependsOn[${dependencyIndex}]`, message: `unknown dependency ${dependency}` });
      }
      if (dependencyIndexes.has(dependency)) {
        issues.push({ path: `$.tasks[${index}].dependsOn[${dependencyIndex}]`, message: `duplicate dependency ${dependency}` });
      }
      dependencyIndexes.add(dependency);
    }
  }

  const dependencies = new Map<string, readonly string[]>();
  for (const task of manifest.tasks) {
    if (!dependencies.has(task.id)) dependencies.set(task.id, task.dependsOn);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    const cycleStart = stack.indexOf(taskId);
    if (cycleStart !== -1) {
      issues.push({ path: "$.tasks", message: `dependency cycle detected: ${[...stack.slice(cycleStart), taskId].join(" -> ")}` });
      return;
    }
    const taskDependencies = dependencies.get(taskId);
    if (taskDependencies === undefined) return;
    visiting.add(taskId);
    stack.push(taskId);
    for (const dependency of taskDependencies) {
      if (visiting.has(dependency)) {
        visit(dependency);
      } else if (dependencies.has(dependency)) {
        visit(dependency);
      }
    }
    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const task of manifest.tasks) visit(task.id);

  if (issues.length > 0) {
    const location = filePath === undefined ? "task manifest" : `task manifest (${filePath})`;
    throw new SchemaValidationError(location, issues);
  }
  return manifest;
}
