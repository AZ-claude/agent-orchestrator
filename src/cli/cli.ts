import { PrivacySafeLogger } from "../logging/index.js";

export type CliCommand = "bootstrap" | "run-once" | "daemon" | "reconcile" | "status";
export interface CliOperations {
  readonly bootstrap: () => Promise<void>;
  readonly runOnce: () => Promise<void>;
  readonly reconcile: () => Promise<void>;
  readonly status: () => Promise<void>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
}

export function parseCli(argv: readonly string[]): CliCommand {
  const command = argv[0];
  if (command === "bootstrap" || command === "run-once" || command === "daemon" || command === "reconcile" || command === "status") return command;
  throw new Error("usage: agent-orchestrator <bootstrap|run-once|daemon|reconcile|status>");
}

export async function runCli(argv: readonly string[], operations: CliOperations, logger = new PrivacySafeLogger()): Promise<void> {
  const command = parseCli(argv);
  if (command === "bootstrap") return operations.bootstrap();
  if (command === "run-once") return operations.runOnce();
  if (command === "reconcile") return operations.reconcile();
  if (command === "status") return operations.status();
  const sleep = operations.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const interval = operations.pollIntervalMs ?? 30_000;
  logger.info("daemon_started", { pollIntervalMs: interval });
  for (;;) {
    await operations.runOnce();
    await sleep(interval);
  }
}
