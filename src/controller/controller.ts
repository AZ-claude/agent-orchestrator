import { ReviewResult } from "../config/index.js";
import { ReviewPacket } from "../validation/index.js";

export interface IndependentReviewer { review(packet: ReviewPacket): Promise<"APPROVE" | { readonly result: "REWORK"; readonly reason: string } | { readonly result: "CAPABILITY_UNAVAILABLE"; readonly reason: string }>; }
export interface TerraReviewer { review(packet: ReviewPacket): Promise<ReviewResult>; }
export interface ControllerDependencies {
  readonly validate: () => Promise<ReviewPacket>;
  readonly reviewer: IndependentReviewer;
  readonly terra: TerraReviewer;
  readonly resumeLuna: (reason: string) => Promise<void>;
  readonly setState: (state: "reviewing" | "rework" | "blocked-human") => Promise<void>;
  readonly verifyRemoteBaseContains: (head: string) => Promise<boolean>;
  readonly closeIssue: () => Promise<void>;
}

export interface ControllerResult { readonly status: "approved" | "blocked-human"; readonly reviewRounds: number; readonly packet: ReviewPacket; }

/** Orchestrates review ordering only; it never performs a Git merge. */
export class ReviewCloseController {
  constructor(private readonly deps: ControllerDependencies) {}

  async processWorkerDone(): Promise<ControllerResult> {
    let packet = await this.deps.validate();
    let reviewRounds = 0;
    for (;;) {
      reviewRounds += 1;
      await this.deps.setState("reviewing");
      const independent = await this.deps.reviewer.review(packet);
      if (independent !== "APPROVE") {
        if (independent.result === "CAPABILITY_UNAVAILABLE") {
          await this.deps.setState("blocked-human");
          return { status: "blocked-human", reviewRounds, packet };
        }
        await this.deps.setState("rework");
        await this.deps.resumeLuna(independent.reason);
        packet = await this.deps.validate();
        continue;
      }
      const terra = await this.deps.terra.review(packet);
      if (terra.result === "APPROVE") {
        if (!(await this.deps.verifyRemoteBaseContains(packet.head))) {
          await this.deps.setState("blocked-human");
          return { status: "blocked-human", reviewRounds, packet };
        }
        await this.deps.closeIssue();
        return { status: "approved", reviewRounds, packet };
      }
      if (terra.result === "BLOCKED_HUMAN") {
        await this.deps.setState("blocked-human");
        return { status: "blocked-human", reviewRounds, packet };
      }
      await this.deps.setState("rework");
      await this.deps.resumeLuna(terra.reason);
      packet = await this.deps.validate();
    }
  }
}
