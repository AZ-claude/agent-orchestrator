import { Checkpoint } from "../config/index.js";
import { WorkerDispatchResult } from "./routing.js";

/** Converts a worker observation into checkpoint-safe, provider-neutral facts. */
export function addWorkerEvidence(checkpoint: Checkpoint, dispatch: WorkerDispatchResult, runId: string, localModel?: string): Checkpoint {
  const run = dispatch.run;
  return {
    ...checkpoint,
    runId,
    workerRole: run.role,
    workerProvider: run.provider,
    workerAdapter: run.adapter,
    workerMode: dispatch.routing.mode,
    configuredPrimary: dispatch.routing.configuredPrimary,
    configuredRecovery: dispatch.routing.configuredRecovery,
    ...(localModel === undefined ? {} : { localModel }),
    processOutcome: run.outcome,
    ...(dispatch.routing.fallback === undefined ? {} : { providerFallback: dispatch.routing.fallback }),
  };
}
