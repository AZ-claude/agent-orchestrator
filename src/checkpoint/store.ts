import { constants } from "node:fs";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Checkpoint, checkpointSchema } from "../config/index.js";

export const CHECKPOINT_VERSION = 1;

export class CheckpointStore {
  constructor(readonly root: string) {}

  async save(checkpoint: Checkpoint): Promise<void> {
    checkpointSchema.parse(checkpoint);
    const path = this.pathFor(checkpoint.taskId);
    await mkdir(this.root, { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try {
      await handle.writeFile(`${JSON.stringify({ version: CHECKPOINT_VERSION, checkpoint })}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  }

  async load(taskId: string): Promise<Checkpoint | null> {
    try {
      const raw = JSON.parse(await readFile(this.pathFor(taskId), "utf8")) as unknown;
      const checkpoint = migrateCheckpoint(raw);
      if (checkpoint.taskId !== taskId) throw new Error(`checkpoint filename/taskId mismatch: ${taskId} != ${checkpoint.taskId}`);
      return checkpoint;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async list(): Promise<Checkpoint[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const checkpoints: Checkpoint[] = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      const value = JSON.parse(await readFile(join(this.root, name), "utf8")) as unknown;
      const taskId = name.slice(0, -".json".length);
      const checkpoint = migrateCheckpoint(value);
      if (checkpoint.taskId !== taskId) throw new Error(`checkpoint filename/taskId mismatch: ${taskId} != ${checkpoint.taskId}`);
      checkpoints.push(checkpoint);
    }
    return checkpoints;
  }

  async remove(taskId: string): Promise<void> {
    try {
      await unlink(this.pathFor(taskId));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private pathFor(taskId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) throw new Error("invalid checkpoint task ID");
    return join(this.root, `${taskId}.json`);
  }
}

export function migrateCheckpoint(value: unknown): Checkpoint {
  if (isRecord(value) && value.version === CHECKPOINT_VERSION) {
    if (Object.keys(value).some((key) => key !== "version" && key !== "checkpoint") || !("checkpoint" in value)) throw new Error("checkpoint version envelope contains unknown fields");
    return checkpointSchema.parse(value.checkpoint);
  }
  // Version zero was the unwrapped checkpoint format. Parsing it strictly here
  // makes restart fail closed instead of silently dropping unknown state.
  return checkpointSchema.parse(value);
}

export function checkpointPath(root: string, taskId: string): string {
  return join(root, `${taskId}.json`);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
