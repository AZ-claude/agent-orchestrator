import assert from "node:assert/strict";
import test from "node:test";
import { GitHubIssueProjector, GhClient, STATE_LABEL, TASK_MARKER } from "../src/github/index.js";

class FakeGh implements GhClient {
  next = 10;
  calls: string[][] = [];
  async run(args: readonly string[]) {
    this.calls.push([...args]);
    if (args[0] === "issue" && args[1] === "list") return { stdout: "[]", stderr: "", code: 0 };
    if (args[0] === "issue" && args[1] === "create") return { stdout: `https://github.com/example/repo/issues/${this.next++}`, stderr: "", code: 0 };
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

test("uses gh-compatible parent, blocking, idempotence, and state-preserving calls", async () => {
  const fake = new FakeGh();
  const withDependency = { ...manifest, tasks: [{ ...manifest.tasks[0], id: "AO-05", dependsOn: ["AO-06"] }, { ...manifest.tasks[0], id: "AO-06", dependsOn: [] }] } as const;
  const projector = new GitHubIssueProjector(fake);
  await projector.project(withDependency);
  const createCalls = fake.calls.filter((call) => call[0] === "issue" && call[1] === "create");
  assert.ok(createCalls.some((call) => call.includes("--parent")));
  assert.ok(fake.calls.some((call) => call.includes("--add-blocked-by")));
  assert.ok(fake.calls.some((call) => call.includes("--remove-label") && call.join(" ").includes("ao:state:ready,ao:state:running")));
});

test("reads parent/blocking fields and pins the gh repository", async () => {
  const client = new (await import("../src/github/index.js")).CliGhClient(async (_command, args) => {
    assert.ok(args.includes("--repo"));
    assert.equal(args[args.indexOf("--repo") + 1], "AZ-claude/slot");
    return { stdout: JSON.stringify([{ number: 4, title: "x", body: TASK_MARKER("AO-05"), state: "OPEN", labels: [{ name: "ao:state:running" }], parent: { number: 2 }, blockedBy: [{ number: 3 }] }]), stderr: "", code: 0 };
  });
  const snapshot = await new GitHubIssueProjector(client).readOpen();
  assert.equal(snapshot[0]?.parentNumber, 2);
  assert.deepEqual(snapshot[0]?.blockedBy, [3]);
});
