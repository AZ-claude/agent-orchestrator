# Agent Orchestrator pre-install delta task board

Updated: 2026-09-02 JST  
Canonical requirements: [pre-install delta HANDOFF](../HANDOFF_2026-09-02_AGENT_ORCHESTRATOR_PREINSTALL_DELTA.md)  
Legacy boundary: [v1 requirements](../HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md), [v1 design](../DESIGN_2026-08-31_AGENT_ORCHESTRATOR_V1.md)  
Machine-readable plan: [`tasks/agent-orchestrator-preinstall-delta.yaml`](../../tasks/agent-orchestrator-preinstall-delta.yaml)

Status: **PLANNED — AO-01 through AO-16 history is preserved; no pre-install delta implementation has started.**

## 0. Authority, boundary, and common acceptance

- This board is the Terra-owned plan projection of the 2026-09-02 canonical HANDOFF. Only Terra may change a task's scope, dependency, acceptance, parallel policy, Human Gate, or any other DAG meaning. Worker, Independent Reviewer, and daemon may report evidence or a structured claim only.
- The daemon remains non-LLM. It may schedule, validate, route, count retries, merge when deterministic gates pass, close Issues, reconcile, and retire/clean up sessions; it must not make semantic or requirement judgments.
- The normal flow is Primary Worker (Luna) -> machine validation -> Independent Reviewer -> deterministic gates -> daemon auto-merge/close/cleanup. Terra has no normal per-task review or merge role.
- A normal `REWORK` returns to the same Primary Worker session, for at most three review/rework cycles. A repeated finding, normalized test failure, or simple diff oscillation is an early deterministic `STUCK`; exactly one fresh Luna Recovery Worker may take over and must also receive Independent Reviewer review.
- `PLAN_CONFLICT` is a contradiction or omission in this board/DAG while canonical requirements are clear. It requires a structured Worker claim and an Independent Reviewer `PLAN_CONFLICT_CONFIRMED` result before Terra Plan Revision. `REQUIREMENT_CONFLICT` is ambiguity/contradiction in canonical requirements and is `BLOCKED_HUMAN`; neither Terra nor the daemon rewrites the canonical HANDOFF.
- During confirmed Plan Revision the daemon pauses only the affected task/downstream set, enables a global merge barrier, and permits unrelated SAFE Workers to implement/test/push. A revised board/manifest is re-synchronized before the barrier is released.
- Human Gates are limited to `REQUIREMENT_CONFLICT`, Recovery-exhausted pure implementation failure, and a task predeclared here as a materially consequential operation. Existing AO-16's real-host LaunchAgent install remains the only currently predeclared operation; it is not an AO-17+ implementation task.
- Every implementation task also requires its task test, relevant `npm test`, `npm run build`, and `npm run lint`, clean/pushed branch evidence, scope evidence, an Independent Reviewer `APPROVE`, and all deterministic merge gates. No task authorizes an actual host install, production mutation, deploy, credential action, or `/slot` runtime/Scheduler change.

## 1. Delta DAG

```text
AO-17 (contract/schema) ─┬─ AO-19 (review/rework/recovery) ─┬─ AO-20 (plan-conflict/barrier/reconcile) ─ AO-21 (runtime integration) ─ AO-22 (pilot evidence) ─ AO-23 (Final Terra Acceptance)
                         │                                  │
AO-18 (deterministic merge gates) ───────────────────────────┘
```

`AO-17` and `AO-18` are initially READY and SAFE. They have disjoint allowed paths. AO-20 and AO-21 are EXCLUSIVE because they change cross-component execution-state behavior.

## 2. Delta tasks

### AO-17 — Canonical delta contract, manifest, and durable state

- State: PLANNED; dependencies: none; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/config/**`, `src/manifest/**`, `src/checkpoint/**`, `prompts/luna-implementation-task.md`, `test/config.test.ts`, `test/manifest.test.ts`, `test/checkpoint.test.ts`.
- Non-scope: controller routing, Git merge commands, scheduler policy, Qwen/Ollama/provider router, production state, and retroactive edits to AO-01–AO-16.
- Completion / acceptance: accepts a versioned pre-install delta manifest and task-level free-text `assumptions`/`invariants`; records only durable, non-secret lifecycle/review/recovery/claim facts needed by later tasks; represents Primary versus fresh Recovery Worker without a provider-selection framework; rejects unknown/unsafe schema data fail-closed.
- Verification: focused config/manifest/checkpoint tests plus `npm test`, `npm run build`, `npm run lint`.
- Assumptions: AO-01–AO-16 artifacts remain readable under their legacy schema; YAML is the daemon's canonical projection and Markdown is not parsed as a substitute.
- Invariants: checkpoints never hold secrets or private reasoning; task-board meaning is not mutable through runtime state; existing v1 manifest behavior remains backward compatible.

### AO-18 — Deterministic reviewed-HEAD merge gates and Git adapter

- State: PLANNED; dependencies: none; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/git/**`, `src/validation/**`, `test/git.test.ts`, `test/validation.test.ts`.
- Non-scope: reviewer semantic decision, scheduler policy, GitHub Issue projection, generic merge queue, production branch mutation outside disposable test remotes.
- Completion / acceptance: provides an explicit, testable daemon-only merge operation that follows target-repository Git rules and proceeds only after tests, validation, scope/unexpected-diff, clean worktree, pushed branch, dependency/base consistency, reviewed-HEAD equality, no unresolved Human Gate, and no merge barrier all pass; a changed reviewed HEAD refuses merge/close.
- Verification: disposable local-remote fixture tests cover each failed gate and the all-pass merge path, then `npm test`, `npm run build`, `npm run lint`.
- Assumptions: the target repository continues to expose a deterministic base branch and ordinary Git merge operation for its branch rules.
- Invariants: daemon never infers semantic approval, never merges a dirty or unreviewed HEAD, and merge evidence is durable and machine-verifiable.

### AO-19 — Independent Reviewer, bounded Primary REWORK, and fresh Recovery Worker

- State: PLANNED; dependencies: AO-17, AO-18; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/luna/**`, `src/controller/**`, `prompts/luna-implementation-task.md`, `test/luna.test.ts`, `test/controller.test.ts`, `test/fixtures/codex/**`.
- Non-scope: new LLM provider integration, model/task router, Terra normal review, board/manifest editing, scheduler/barrier implementation, production dispatch.
- Completion / acceptance: replaces Terra normal-task review with a code-changing-forbidden Independent Reviewer contract; routes ordinary REWORK to the same Primary session with maximum three cycles; detects two consecutive equal normalized findings/test failures or simple documented diff oscillation as early STUCK; retires the old Primary and starts one fresh Luna Recovery session from durable evidence; requires the same reviewer and deterministic gates for Recovery; classifies Recovery exhaustion as PLAN_CONFLICT suspicion or pure implementation `BLOCKED_HUMAN`, never as Terra code-fix work.
- Verification: fixtures prove same-session rework limit, each early-STUCK signal, fresh recovery (not history resume), reviewer requirement in recovery, and exhausted-path classification; then `npm test`, `npm run build`, `npm run lint`.
- Assumptions: Codex's existing new/resume lifecycle contract can create a distinct fresh session and existing reviewer transport can remain independent/read-only.
- Invariants: reviewer receives no implementation reasoning/history and cannot alter code; normal implementation failure is not a PLAN_CONFLICT; no task board/DAG field is written by Worker or Reviewer.

### AO-20 — Confirmed PLAN_CONFLICT routing, merge barrier, reconciliation, and lifecycle cleanup

- State: PLANNED; dependencies: AO-17, AO-19; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `src/scheduler/**`, `src/reconcile/**`, `src/checkpoint/**`, `src/github/**`, `test/scheduler.test.ts`, `test/reconcile.test.ts`, `test/checkpoint.test.ts`, `test/github.test.ts`.
- Non-scope: Terra Plan Revision content, requirement rewrites, controller semantic review implementation, complex impact-analysis/lock/queue framework, actual external Issue mutation beyond fixture coverage.
- Completion / acceptance: persists and routes the required structured PLAN_CONFLICT claim; only an Independent Reviewer confirmation activates Plan Revision state; activates a simple global merge barrier, pauses only affected task/downstream dependencies, continues unrelated SAFE execution, and refuses all merges while active; maintains `ACTIVE`, `RESUMABLE`, `RETIRED`, and safe cleanup semantics; cleans reviewer sessions after durable evidence and task sessions only after close/takeover/revision retirement, never RESUMABLE sessions; accepts an explicit revision resume/restart instruction and re-synchronizes board/manifest facts deterministically.
- Verification: table/fixture tests cover unconfirmed claim rejection, confirmed barrier, unrelated SAFE continuation, gate refusal during barrier, affected downstream pause, resume versus fresh restart directive, closed-task cleanup, rate-limit/resumable preservation, and restart/reconcile; then `npm test`, `npm run build`, `npm run lint`.
- Assumptions: Terra Plan Revision is represented as a durable external board/manifest update plus a small explicit resume/restart directive rather than inferred from prose.
- Invariants: daemon never decides whether a claim is semantically valid, no global worker stop is required, and REQUIREMENT_CONFLICT routes only to Human Gate.

### AO-21 — Pre-install runtime integration, authority enforcement, and operator contract

- State: PLANNED; dependencies: AO-17, AO-18, AO-19, AO-20; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `src/cli/**`, `src/controller/**`, `src/logging/**`, `docs/runbooks/agent-orchestrator.md`, `prompts/luna-implementation-task.md`, `test/cli.test.ts`, `test/controller.test.ts`.
- Non-scope: host LaunchAgent installation, packaging changes, production/deploy/Scheduler mutation, final acceptance evidence, provider routing, dashboard/UI.
- Completion / acceptance: wires the planned contracts into normal daemon flow without an LLM call in polling/scheduling/validation/merge decision; removes normal Terra review/merge invocation; documents and enforces the authority matrix, Human Gate taxonomy, deterministic daemon auto-merge/close/unlock, cleanup, and Plan Revision barrier behavior; leaves Terra callable only for Planning, reviewer-confirmed Plan Revision, and final acceptance.
- Verification: integration tests demonstrate normal APPROVE -> deterministic merge/close/unlock with no Terra call, each gate refusal, authority-protected plan fields, and no host mutation; then `npm test`, `npm run build`, `npm run lint`.
- Assumptions: AO-17–AO-20 expose narrow typed interfaces sufficient for CLI composition; no actual daemon process must be installed to test wiring.
- Invariants: daemon contains no semantic judgment; normal merge cannot be triggered by reviewer APPROVE alone; operator-only LaunchAgent commands remain separate from daemon startup.

### AO-22 — Non-production pre-install delta pilot and durable evidence

- State: PLANNED; dependencies: AO-17, AO-18, AO-19, AO-20, AO-21; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `scripts/pilot/**`, `test/pilot.test.ts`, `docs/agent-runs/**`, `docs/runbooks/agent-orchestrator.md`.
- Non-scope: production `/slot` data/runtime/Scheduler, LaunchAgent install/load, source behavior changes, public/deploy actions.
- Completion / acceptance: extends disposable fixture evidence for all 2026-09-02 acceptance points: independent approval/daemon merge gates, reviewed-head refusal, bounded rework/early STUCK/fresh recovery, recovery classification, confirmed PLAN_CONFLICT/barrier/Safe continuation/resync, lifecycle cleanup/resumable retention, authority/Human-Gate behavior, and unchanged v1 pilot safety boundary.
- Verification: `npm test -- pilot`, full `npm test`, `npm run build`, `npm run lint`; evidence identifies only disposable/local fixtures.
- Assumptions: all upstream tasks provide fakeable adapters and durable result artifacts.
- Invariants: pilot never performs external host installation, production mutation, or uses a live `/slot` operational task.

### AO-23 — Final Terra Acceptance of the pre-install delta

- State: PLANNED; dependencies: AO-22; parallel: EXCLUSIVE; Human Gate: none unless result is `REQUIREMENT_CONFLICT`.
- Scope / allowed paths: `docs/agent-runs/**`, `docs/task-boards/**`, `test/final-acceptance.test.ts`.
- Non-scope: code fixes, daemon configuration/operation, manifest/DAG changes except creation of a new corrective task by Terra after a `REWORK`, actual LaunchAgent install.
- Completion / acceptance: Terra validates the merged whole product against the canonical 2026-09-02 HANDOFF and records PASS, REWORK-task creation, or REQUIREMENT_CONFLICT. A discovered code defect produces a new scoped task returning through Worker -> Independent Reviewer -> deterministic daemon merge; Terra does not edit code.
- Verification: final-acceptance test and full `npm test`, `npm run build`, `npm run lint`; evidence links every delta acceptance item to tests/run evidence.
- Assumptions: AO-22 is merged with durable evidence and no unresolved Human Gate.
- Invariants: Final Terra Acceptance is whole-product only, never a substitute for per-task semantic review or direct code repair; real-host install remains out of scope.

## 3. Consistency audit (Planning Terra, 2026-09-02)

| Audit | Result |
|---|---|
| Canonical requirements versus scope | PASS — each delta acceptance is owned once; legacy v1 boundaries remain explicit. |
| Simultaneous acceptance criteria | PASS — semantic approval precedes deterministic facts; no criterion requires daemon semantic judgment or Terra normal merge. |
| Dependencies/DAG | PASS — AO-17/AO-18 are roots; all later edges point to completed prerequisites; no cycle or reversed dependency. |
| Scope sufficient for completion | PASS — each task includes source, tests, and required durable docs; cross-component wiring is reserved to AO-21. |
| Non-scope feasibility | PASS — none requires provider router, real host install, production mutation, or canonical-HANDOFF rewrite. |
| Assumptions/invariants | PASS — no conflicting provider, authority, lifecycle, or safety assumption. |
| SAFE/EXCLUSIVE | PASS — initial SAFE tasks have disjoint paths; stateful orchestration integration is serialized as EXCLUSIVE. |
| Existing completed work | PASS — AO-01–AO-16 are referenced as prerequisites/legacy evidence and are not recreated. |

## 4. Human Gate and install status

The only predeclared operation gate remains AO-16's real-host LaunchAgent registration/enabling. The three runtime Human Gate categories are exactly those in the canonical delta HANDOFF. This planning task did not call `launchctl`, `packaging/launchd/manage.sh install`, or any host-install command.
