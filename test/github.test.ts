import assert from "node:assert/strict";
import test from "node:test";
import { GitHubIssueProjector, GhClient, STATE_LABEL, TASK_MARKER } from "../src/github/index.js";

class FakeGh implements GhClient {
  next = 10;
  calls: string[][] = [];
  async run(args: readonly string[]) {
    this.calls.push([...args]);
    if (args[0] === "issue" && args[1] === "list") return { stdout: "[]", stderr: "", code: 0 };
    if (args[0] === "issue" && args[1] === "create") return { stdout: JSON.stringify({ number: this.next++, title: args[3], body: args[5], state: "OPEN", labels: [] }), stderr: "", code: 0 };
    return { stdout: "", stderr: "", code: 0 };
  }
}
const manifest = { handoff: { id: "h", source: "docs/h", board: "docs/b", targetRepo: "/Users/eita/projects/slot", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md" }, workerCompletionContract: { independentReview: "required", reviewer: "same-session-read-only-luna-subagent", reviewerContext: "task-scope-source-head-review-packet-only", reviewerHistory: "none", onRework: "same-implementation-session-fix-validate-rereview", completion: "reviewer-approve-required-before-terra", fallback: "only-if-subagent-capability-unavailable" }, tasks: [{ id: "AO-05", title: "issues", dependsOn: [], parallel: "SAFE", humanGate: false, allowedPaths: ["src/github/**"], test: "npm test -- github" }] } as const;

test("projects idempotent marker bodies and exclusive state labels", async () => {
  const fake = new FakeGh();
  const result = await new GitHubIssueProjector(fake).project(manifest);
  assert.equal(result.tasks.get("AO-05")?.number, 11);
  assert.ok(fake.calls.some((call) => call.join(" ").includes(TASK_MARKER("AO-05"))));
  const stateCall = fake.calls.find((call) => call.includes("--add-label"));
  assert.ok(stateCall?.includes(STATE_LABEL("ready")));
  const addIndex = stateCall?.indexOf("--add-label") ?? -1;
  assert.equal(new Set((stateCall ?? []).slice(addIndex + 1).filter((item) => item.startsWith("ao:state:"))).size, 1);
});
