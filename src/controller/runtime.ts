import { ManifestTask, WorkerRole } from "../config/index.js";
import { ReviewCloseController, ControllerDependencies, ControllerResult } from "./controller.js";
import { assertCanMerge } from "./authority.js";
import { ReviewPacket } from "../validation/index.js";

export interface DaemonRuntimeDependencies extends ControllerDependencies {
  readonly task?: ManifestTask;
}

/** Narrow composition root for the pre-install delta. It contains no LLM call. */
export class DaemonTaskRuntime {
  constructor(private readonly deps: DaemonRuntimeDependencies) {}

  async processWorkerDone(): Promise<ControllerResult> {
    assertCanMerge("daemon");
    return new ReviewCloseController(this.deps).processWorkerDone();
  }

  static durableRecoverySummary(packet: ReviewPacket, role: WorkerRole): string {
    return JSON.stringify({ taskId: packet.taskId, role, head: packet.head, acceptance: packet.acceptance, testPass: packet.test.pass, scope: packet.scope, clean: packet.clean });
  }
}
