import assert from "node:assert/strict";
import test from "node:test";

import { parseManifest as parseManifestShape, SchemaValidationError } from "../../src/config/schema.js";
import { ManifestParseError } from "../../src/manifest/errors.js";
import { loadManifest, parseManifest } from "../../src/manifest/index.js";

const validManifest = `
handoff:
  id: agent-orchestrator-v1
  source: docs/HANDOFF.md
  board: docs/task-board.md
  targetRepo: /Users/eita/projects/slot
  baseBranch: main
tasks:
  - id: AO-01
    title: First task
    dependsOn: []
    parallel: SAFE
    humanGate: false
    allowedPaths: [src/first/**]
    test: npm test -- first
  - id: AO-02
    title: Second task
    dependsOn: [AO-01]
    parallel: EXCLUSIVE
    humanGate: true
    allowedPaths: [src/second/**]
    test: npm test -- second
`;

function expectValidationError(source: string, expected: RegExp): void {
  assert.throws(
    () => parseManifest(source),
    (error: unknown) => error instanceof SchemaValidationError && expected.test(error.message),
  );
}

test("parses the canonical manifest and preserves task order", () => {
  const manifest = parseManifest(validManifest);
  assert.equal(manifest.handoff.id, "agent-orchestrator-v1");
  assert.deepEqual(manifest.tasks.map((task) => [task.id, task.dependsOn, task.parallel]), [
    ["AO-01", [], "SAFE"],
    ["AO-02", ["AO-01"], "EXCLUSIVE"],
  ]);
});

test("loads and validates the checked-in canonical manifest", async () => {
  const manifest = await loadManifest("tasks/agent-orchestrator-v1.yaml");
  assert.equal(manifest.handoff.id, "agent-orchestrator-v1");
  assert.equal(manifest.tasks.length, 16);
});

test("keeps YAML parsing separate from schema validation", () => {
  assert.throws(() => parseManifest("handoff: ["), (error: unknown) => error instanceof ManifestParseError);
  assert.throws(() => parseManifestShape({}), SchemaValidationError);
});

test("fails closed for duplicate task IDs", () => {
  expectValidationError(validManifest.replace("id: AO-02", "id: AO-01"), /duplicate task id AO-01/);
});

test("fails closed for unknown dependencies", () => {
  expectValidationError(validManifest.replace("dependsOn: [AO-01]", "dependsOn: [AO-99]"), /unknown dependency AO-99/);
});

test("fails closed for dependency cycles", () => {
  const cyclic = validManifest
    .replace("dependsOn: []", "dependsOn: [AO-02]")
    .replace("dependsOn: [AO-01]", "dependsOn: [AO-01]");
  expectValidationError(cyclic, /dependency cycle detected/);
});

test("fails closed for invalid parallel policies", () => {
  expectValidationError(validManifest.replace("parallel: EXCLUSIVE", "parallel: SOMETIMES"), /parallel.*one of SAFE, EXCLUSIVE/);
});

test("fails closed for unsupported block scalar modifiers", () => {
  assert.throws(() => parseManifest(validManifest.replace("title: First task", "title: |-")), ManifestParseError);
  assert.throws(() => parseManifest(validManifest.replace("title: First task", "title: >-")), ManifestParseError);
});

test("fails closed for malformed quoted scalars with trailing tokens", () => {
  assert.throws(() => parseManifest(validManifest.replace("title: First task", "title: 'First task' junk")), ManifestParseError);
});

test("accepts valid double-quoted scalars", () => {
  const manifest = parseManifest(validManifest.replace("title: First task", 'title: "First task"'));
  assert.equal(manifest.tasks[0]?.title, "First task");
});

test("rejects duplicate YAML mapping keys", () => {
  assert.throws(() => parseManifest(validManifest.replace("  id: agent-orchestrator-v1", "  id: agent-orchestrator-v1\n  id: duplicate")), ManifestParseError);
});
