import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export const LEASE_SCHEMA_VERSION = 1 as const;
export type LeaseOwner = "agent-orchestrator" | "kiji";
export type LeaseStatus = "acquired" | "busy" | "timeout" | "malformed" | "released" | "release-skipped";

export interface LeaseRecord {
  readonly schemaVersion: typeof LEASE_SCHEMA_VERSION;
  readonly owner: LeaseOwner;
  readonly model: string;
  readonly pid: number;
  readonly nonce: string;
  readonly acquiredAt: string;
}

export interface LeaseEvidence {
  readonly status: LeaseStatus;
  readonly owner: LeaseOwner;
  readonly model: string;
  readonly pid: number;
  readonly recoveredStale?: true;
}

export interface LeaseHandle {
  readonly record: LeaseRecord;
  release(): Promise<LeaseEvidence>;
}

export interface LeaseAcquireResult {
  readonly evidence: LeaseEvidence;
  readonly handle?: LeaseHandle;
}

export interface LocalInferenceLeaseOptions {
  readonly path: string;
  readonly owner: LeaseOwner;
  readonly model: string;
  readonly pid?: number;
  readonly waitMs?: number;
  readonly pollMs?: number;
  readonly processAlive?: (pid: number) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
}

interface LeaseClaim { readonly owner: LeaseOwner; readonly pid: number; readonly nonce: string; }

/** A small, cross-client, filesystem-safe capacity-one lease. */
export class LocalInferenceLease {
  private readonly pid: number;
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly processAlive: (pid: number) => boolean;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: LocalInferenceLeaseOptions) {
    this.pid = options.pid ?? process.pid;
    this.waitMs = Math.max(0, options.waitMs ?? 0);
    this.pollMs = Math.max(1, options.pollMs ?? 50);
    this.processAlive = options.processAlive ?? defaultProcessAlive;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async acquire(): Promise<LeaseAcquireResult> {
    await mkdir(dirname(this.options.path), { recursive: true });
    const deadline = Date.now() + this.waitMs;
    let recoveredStale = false;
    for (;;) {
      const record: LeaseRecord = {
        schemaVersion: LEASE_SCHEMA_VERSION,
        owner: this.options.owner,
        model: this.options.model,
        pid: this.pid,
        nonce: randomUUID(),
        acquiredAt: new Date().toISOString(),
      };
      try {
        await mkdir(this.options.path);
        try {
          await writeFile(`${this.options.path}/owner.json`, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx" });
        } catch (error) {
          await rm(this.options.path, { recursive: true, force: true });
          throw error;
        }
        return { evidence: evidence(record, "acquired", recoveredStale), handle: this.handle(record) };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }

      const current = await this.readRecord();
      if (current === "malformed") return { evidence: { status: "malformed", owner: this.options.owner, model: this.options.model, pid: this.pid } };
      if (current !== null && current.owner === this.options.owner && !this.processAlive(current.pid)) {
        const stalePath = `${this.options.path}.stale-${current.nonce}`;
        const claimPath = `${this.options.path}/claim.json`;
        let claimed = false;
        let moved = false;
        try {
          claimed = await this.createClaim(claimPath, current.nonce);
          if (!claimed) return { evidence: { status: "busy", owner: current.owner, model: current.model, pid: current.pid } };
          const confirmed = await this.readRecord();
          if (confirmed === null || confirmed === "malformed" || !sameRecord(confirmed, current)) continue;
          await rename(this.options.path, stalePath);
          moved = true;
          await rm(stalePath, { recursive: true, force: true });
          recoveredStale = true;
          continue;
        } catch (error) {
          if (!isAlreadyExists(error) && !isNotFound(error)) throw error;
        } finally {
          if (claimed) await rm(moved ? `${stalePath}/claim.json` : claimPath, { force: true });
        }
      }
      if (Date.now() >= deadline) {
        return { evidence: { status: this.waitMs > 0 ? "timeout" : "busy", owner: current?.owner ?? this.options.owner, model: current?.model ?? this.options.model, pid: current?.pid ?? this.pid } };
      }
      await this.sleep(Math.min(this.pollMs, Math.max(1, deadline - Date.now())));
    }
  }

  /** Reconcile only a well-formed, demonstrably dead record owned by this client. */
  async releaseStaleOwner(): Promise<boolean> {
    const current = await this.readRecord();
    if (current === null || current === "malformed" || current.owner !== this.options.owner || this.processAlive(current.pid)) return false;
    const stalePath = `${this.options.path}.stale-${current.nonce}`;
    const claimPath = `${this.options.path}/claim.json`;
    let claimed = false;
    let moved = false;
    try {
      claimed = await this.createClaim(claimPath, current.nonce);
      if (!claimed) return false;
      const confirmed = await this.readRecord();
      if (confirmed === null || confirmed === "malformed" || !sameRecord(confirmed, current)) return false;
      await rename(this.options.path, stalePath);
      moved = true;
      await rm(stalePath, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (!isAlreadyExists(error) && !isNotFound(error)) throw error;
      return false;
    } finally {
      if (claimed) await rm(moved ? `${stalePath}/claim.json` : claimPath, { force: true });
    }
  }

  private async readRecord(): Promise<LeaseRecord | "malformed" | null> {
    try {
      const value = JSON.parse(await readFile(`${this.options.path}/owner.json`, "utf8")) as unknown;
      if (!isRecord(value)) return "malformed";
      const pid = value.pid;
      if (value.schemaVersion !== LEASE_SCHEMA_VERSION || !isOwner(value.owner) || typeof value.model !== "string" || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || typeof value.nonce !== "string" || typeof value.acquiredAt !== "string") return "malformed";
      return value as unknown as LeaseRecord;
    } catch (error) {
      return isNotFound(error) ? null : "malformed";
    }
  }

  private async createClaim(claimPath: string, nonce: string): Promise<boolean> {
    const claim: LeaseClaim = { owner: this.options.owner, pid: this.pid, nonce };
    try {
      await writeFile(claimPath, `${JSON.stringify(claim)}\n`, { encoding: "utf8", flag: "wx" });
      return true;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      try {
        const current = JSON.parse(await readFile(claimPath, "utf8")) as Partial<LeaseClaim>;
        if (current.owner === this.options.owner && current.nonce === nonce && typeof current.pid === "number" && Number.isInteger(current.pid) && current.pid > 0 && !this.processAlive(current.pid)) {
          await rm(claimPath, { force: false });
          return this.createClaim(claimPath, nonce);
        }
      } catch {
        // An alive or malformed claim is not safe to replace.
      }
      return false;
    }
  }

  private handle(record: LeaseRecord): LeaseHandle {
    return {
      record,
      release: async () => {
        const current = await this.readRecord();
        if (current === "malformed" || current === null || current.nonce !== record.nonce || current.owner !== record.owner || current.pid !== record.pid) {
          return evidence(record, "release-skipped");
        }
        const releasedPath = `${this.options.path}.released-${record.nonce}`;
        const claimPath = `${this.options.path}/claim.json`;
        let claimed = false;
        let moved = false;
        try {
          claimed = await this.createClaim(claimPath, record.nonce);
          if (!claimed) return evidence(record, "release-skipped");
          const confirmed = await this.readRecord();
          if (confirmed === null || confirmed === "malformed" || !sameRecord(confirmed, record)) return evidence(record, "release-skipped");
          await rename(this.options.path, releasedPath);
          moved = true;
          await rm(releasedPath, { recursive: true, force: false });
        } catch (error) {
          if (isAlreadyExists(error) || isNotFound(error)) return evidence(record, "release-skipped");
          throw error;
        } finally {
          if (claimed) await rm(moved ? `${releasedPath}/claim.json` : claimPath, { force: true });
        }
        return evidence(record, "released");
      },
    };
  }
}

function evidence(record: Pick<LeaseRecord, "owner" | "model" | "pid">, status: LeaseStatus, recoveredStale = false): LeaseEvidence {
  return { status, owner: record.owner, model: record.model, pid: record.pid, ...(recoveredStale ? { recoveredStale: true } : {}) };
}

function sameRecord(left: LeaseRecord, right: LeaseRecord): boolean {
  return left.schemaVersion === right.schemaVersion && left.owner === right.owner && left.pid === right.pid && left.nonce === right.nonce;
}

function defaultProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return !isNodeError(error, "ESRCH");
  }
}

function isOwner(value: unknown): value is LeaseOwner { return value === "agent-orchestrator" || value === "kiji"; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isAlreadyExists(error: unknown): boolean { return isNodeError(error, "EEXIST"); }
function isNotFound(error: unknown): boolean { return isNodeError(error, "ENOENT"); }
function isNodeError(error: unknown, code: string): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === code; }
