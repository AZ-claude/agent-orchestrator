import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseManifestText, validateManifestGraph } from "../src/manifest/loader.js";

test("loads the canonical YAML manifest and preserves stable task order", async () => {
  const yaml = await readFile("tasks/agent-orchestrator-v1.yaml", "utf8");
  const manifest = parseManifestText(yaml);
  assert.equal(manifest.handoff.id, "agent-orchestrator-v1");
  assert.equal(manifest.workerCompletionContract.independentReview, "required");
  assert.deepEqual(manifest.tasks.slice(0, 3).map((task) => task.id), ["AO-01", "AO-02", "AO-03"]);
});

const base = {
  handoff: { id: "h", source: "docs/h.md", board: "docs/b.md", targetRepo: "/Users/eita/projects/slot", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md" },
  workerCompletionContract: { independentReview: "required", reviewer: "same-session-read-only-luna-subagent", reviewerContext: "task-scope-source-head-review-packet-only", reviewerHistory: "none", onRework: "same-implementation-session-fix-validate-rereview", completion: "reviewer-approve-required-before-terra", fallback: "only-if-subagent-capability-unavailable" },
};
const task = (id: string, dependsOn: string[]) => ({ id, title: id, dependsOn, parallel: "SAFE", humanGate: false, allowedPaths: ["src/**"], test: "npm test -- manifest" });

test("fails closed for duplicate IDs and unknown dependencies", () => {
  assert.throws(() => parseManifestText(JSON.stringify({ ...base, tasks: [task("AO-01", []), task("AO-01", ["MISSING"])] })), /duplicate task ID|unknown dependency/);
});

test("fails closed for dependency cycles", () => {
  const manifest = { ...base, tasks: [task("AO-01", ["AO-02"]), task("AO-02", ["AO-01"])] };
  assert.throws(() => { validateManifestGraph(manifest as never); }, /cycle/);
});

test("does not parse the human Markdown board as YAML manifest", () => {
  assert.throws(() => parseManifestText("# board\nnot a manifest"), /validation failed/);
});
