import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Read-only observation of Codex's durable session records. */
export async function codexSessionExists(sessionId: string, root = join(homedir(), ".codex", "sessions")): Promise<boolean> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(sessionId)) return false;
  return scan(root, sessionId);
}

async function scan(directory: string, sessionId: string): Promise<boolean> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return false; }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && await scan(path, sessionId)) return true;
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      try { if ((await readFile(path, "utf8")).includes(sessionId)) return true; } catch { /* concurrent rotation */ }
    }
  }
  return false;
}
