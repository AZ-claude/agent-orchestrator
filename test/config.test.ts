import assert from "node:assert/strict";
import test from "node:test";

import {
  checkpointSchema,
  configSchema,
  defaultPilotConfig,
  manifestSchema,
  parseManifest,
  parseManifestForPilot,
  parsePlanConflictClaim,
  parseReviewResult,
  SchemaValidationError,
} from "../src/config/schema.js";

test("default config is a single /slot pilot and is independently cloned", () => {
  const first = defaultPilotConfig();
  const second = defaultPilotConfig();

  assert.equal(first.version, 1);
  assert.equal(first.pilot.targetRepo, "/Users/eita/projects/slot");
  assert.equal(first.pilot.baseBranch, "main");
  assert.equal(first.maxLunaWorkers, 2);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.pilot, second.pilot);
});

test("worker config defaults to cloud and validates explicit local/auto choices", () => {
  const base = defaultPilotConfig();
  assert.equal(configSchema.parse(base).worker, undefined);
  const local = {
    mode: "local",
    primary: "local",
    recovery: "local",
    local: {
      executable: "/tmp/opencode",
      model: "ollama/qwen3.6:35b",
      contextTokens: 262144,
      workdir: "/tmp/worktree",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      configPath: "/tmp/opencode.jsonc",
    },
  } as const;
  const parsed = configSchema.parse({ ...base, worker: local });
  assert.deepEqual(parsed.worker, local);
  assert.equal(configSchema.parse({ ...base, worker: { ...local, mode: "auto" } }).worker?.mode, "auto");
  assert.equal(configSchema.safeParse({ ...base, worker: { ...local, mode: "cloud" } }).success, false);
  assert.equal(configSchema.safeParse({ ...base, worker: { ...local, local: undefined } }).success, false);
  assert.equal(configSchema.safeParse({ ...base, worker: { ...local, local: { ...local.local, contextTokens: 32768 } } }).success, false);
  assert.equal(configSchema.safeParse({ ...base, worker: { ...local, local: { ...local.local, ollamaBaseUrl: "http://user:pass@host:11434" } } }).success, false);
});

test("config schema rejects a multi-repo-shaped config and unknown fields", () => {
  const result = configSchema.safeParse({
    ...defaultPilotConfig(),
    repositories: [],
  });

  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.message, /repositories.*not allowed/);
  assert.throws(() => configSchema.parse({ ...defaultPilotConfig(), pilot: { ...defaultPilotConfig().pilot, targetRepo: "/Users/eita/projects/other" } }), /pilot target/);
});

test("manifest schema validates the YAML projection shape without doing DAG semantics", () => {
  const manifest = {
    handoff: {
      id: "agent-orchestrator-v1",
      source: "docs/HANDOFF.md",
      board: "docs/task-boards/board.md",
      targetRepo: "/Users/eita/projects/slot",
      baseBranch: "main",
      implementationPromptTemplate: "prompts/luna-implementation-task.md",
    },
    workerCompletionContract: {
      independentReview: "required",
      reviewer: "same-session-read-only-luna-subagent",
      reviewerContext: "task-scope-source-head-review-packet-only",
      reviewerHistory: "none",
      onRework: "same-implementation-session-fix-validate-rereview",
      completion: "reviewer-approve-required-before-terra",
      fallback: "only-if-subagent-capability-unavailable",
    },
    tasks: [
      {
        id: "AO-02",
        title: "Node/TS scaffold and configuration schema",
        dependsOn: ["AO-02"],
        parallel: "SAFE",
        humanGate: false,
        allowedPaths: ["src/config/**"],
        test: "npm test -- config",
      },
    ],
  };

  assert.deepEqual(manifestSchema.parse(manifest), manifest);
  assert.throws(() => parseManifest({ ...manifest, handoff: { ...manifest.handoff, targetRepo: "/Users/eita/projects/other" } }), /pilot target/);
  assert.throws(() => parseManifestForPilot({ ...manifest, handoff: { ...manifest.handoff, targetRepo: "/tmp/other" } }, defaultPilotConfig()), /configured pilot target/);
});

test("allowedPaths accepts normal repository globs and rejects repository escapes", () => {
  const baseManifest = {
    handoff: {
      id: "agent-orchestrator-v1",
      source: "docs/HANDOFF.md",
      board: "docs/task-boards/board.md",
      targetRepo: "/Users/eita/projects/slot",
      baseBranch: "main",
      implementationPromptTemplate: "prompts/luna-implementation-task.md",
    },
    workerCompletionContract: {
      independentReview: "required",
      reviewer: "same-session-read-only-luna-subagent",
      reviewerContext: "task-scope-source-head-review-packet-only",
      reviewerHistory: "none",
      onRework: "same-implementation-session-fix-validate-rereview",
      completion: "reviewer-approve-required-before-terra",
      fallback: "only-if-subagent-capability-unavailable",
    },
    tasks: [{ id: "AO-02", title: "schema", dependsOn: [], parallel: "SAFE", humanGate: false, allowedPaths: ["src/config/**", "package.json"], test: "npm test -- config" }],
  };
  assert.deepEqual(manifestSchema.parse(baseManifest).tasks[0]?.allowedPaths, ["src/config/**", "package.json"]);
  for (const escaped of ["../outside", "/absolute/outside", "src/../../outside", "C:/outside", "\\\\server\\outside"]) {
    assert.throws(() => manifestSchema.parse({ ...baseManifest, tasks: [{ ...baseManifest.tasks[0], allowedPaths: [escaped] }] }), /repository-relative glob/);
  }
  assert.equal(manifestSchema.safeParse({ ...baseManifest, handoff: { ...baseManifest.handoff, implementationPromptTemplate: "bad\0path" } }).success, false);
});

test("stateRoot must be outside the pilot repository", () => {
  const config = defaultPilotConfig();
  assert.doesNotThrow(() => configSchema.parse(config));
  assert.throws(() => configSchema.parse({ ...config, stateRoot: "/Users/eita/projects/slot/state" }), /outside the pilot target repository/);
  assert.throws(() => configSchema.parse({ ...config, stateRoot: "/Users/eita/projects/slot/../slot/state" }), /outside the pilot target repository/);
  assert.doesNotThrow(() => configSchema.parse({ ...config, stateRoot: "/Users/eita/projects/agent-orchestrator-state" }));
});

test("checkpoint schema contains only restart data and allows absent process values", () => {
  const checkpoint = {
    issueNumber: 123,
    taskId: "AO-02",
    phase: "luna",
    attempt: 1,
    sessionId: null,
    branch: "agent/AO-02",
    worktree: "/tmp/agent-orchestrator/AO-02",
    pid: null,
    lastHead: null,
    retryAt: null,
  };

  assert.deepEqual(checkpointSchema.parse(checkpoint), checkpoint);
  assert.equal(checkpointSchema.safeParse({ ...checkpoint, prompt: "secret" }).success, false);
});

test("review result requires a concrete reason for rework and human blocking", () => {
  assert.deepEqual(parseReviewResult({ result: "APPROVE" }), { result: "APPROVE" });
  assert.deepEqual(parseReviewResult({ result: "REWORK", reason: "Add the missing test." }), {
    result: "REWORK",
    reason: "Add the missing test.",
  });
  assert.throws(
    () => parseReviewResult({ result: "BLOCKED_HUMAN" }),
    (error: unknown) => error instanceof SchemaValidationError && /reason/.test(error.message),
  );
});

test("canonical manifest requires the independent-review contract", () => {
  const canonical = {
    handoff: { id: "agent-orchestrator-v1", source: "docs/HANDOFF.md", board: "docs/task-boards/board.md", targetRepo: "/Users/eita/projects/slot", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md" },
    workerCompletionContract: { independentReview: "required", reviewer: "same-session-read-only-luna-subagent", reviewerContext: "task-scope-source-head-review-packet-only", reviewerHistory: "none", onRework: "same-implementation-session-fix-validate-rereview", completion: "reviewer-approve-required-before-terra", fallback: "only-if-subagent-capability-unavailable" },
    tasks: [{ id: "AO-02", title: "schema", dependsOn: [], parallel: "SAFE", humanGate: false, allowedPaths: ["src/config/**"], test: "npm test -- config" }],
  };
  assert.doesNotThrow(() => manifestSchema.parse(canonical));
  assert.equal(manifestSchema.safeParse({ ...canonical, workerCompletionContract: undefined }).success, false);
  assert.equal(manifestSchema.safeParse({ ...canonical, handoff: { ...canonical.handoff, implementationPromptTemplate: undefined } }).success, false);
});

test("delta manifest accepts versioned assumptions/invariants and durable facts fail closed", () => {
  const delta = { version: 2, planningAuthority: "Terra", handoff: { id: "agent-orchestrator-preinstall-delta", source: "docs/HANDOFF.md", board: "docs/board.md", targetRepo: "/Users/eita/projects/slot", baseBranch: "main", implementationPromptTemplate: "prompts/luna-implementation-task.md", legacyManifest: "tasks/legacy.yaml" }, tasks: [{ id: "AO-17", title: "contract", state: "PLANNED", dependsOn: [], parallel: "SAFE", humanGate: false, allowedPaths: ["src/config/**"], nonScope: ["production"], completion: "schema", assumptions: ["legacy is readable"], invariants: ["no secret"], test: "true" }] };
  const parsed = manifestSchema.parse(delta);
  assert.equal(parsed.version, 2);
  assert.deepEqual(parsed.tasks[0]?.assumptions, ["legacy is readable"]);
  assert.deepEqual(parsed.tasks[0]?.invariants, ["no secret"]);
  assert.equal(manifestSchema.safeParse({ ...delta, unsafe: true }).success, false);
  assert.throws(() => parsePlanConflictClaim({ conflictType: "PLAN_CONFLICT", taskId: "AO-17", canonicalRequirementRefs: ["HANDOFF"], conflictingTaskFields: ["scope"], repoEvidence: ["file exists"], whyWorkerCannotResolveWithinScope: "required path" , proposedPlanChange: "token=bad" }), /secrets|private reasoning/);
});

test("checkpoint accepts lifecycle/review/recovery facts but no private reasoning", () => {
  const checkpoint = { issueNumber: 1, taskId: "AO-17", phase: "luna", attempt: 1, sessionId: null, branch: "agent/AO-17", worktree: "/tmp/ao", pid: null, lastHead: null, retryAt: null, workerRole: "recovery", lifecycle: "ACTIVE", review: { result: "REWORK", cycle: 1, findingSignature: "missing test" }, recovery: { takeoverCount: 1, status: "active", attemptedFixSummary: "added fixture" } };
  assert.equal(checkpointSchema.parse(checkpoint).workerRole, "recovery");
  assert.equal(checkpointSchema.safeParse({ ...checkpoint, review: { result: "REWORK", cycle: 1, findingSignature: "private reasoning omitted" } }).success, false);
});
