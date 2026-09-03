# Agent Orchestrator — Qwen/OpenCode worker pre-install delta task-board

Updated: 2026-09-03 JST
Planning authority: **Terra**
Canonical requirements: `docs/HANDOFF_2026-09-03_QWEN_OPENCODE_WORKER_DELTA.md` (takes precedence for worker/provider matters)
Accepted predecessor baseline: `91f8098c7966caa2eda6f4788425a3ff39b1ff00`; AO-01 through AO-26 are already DONE and are not recreated here.

## Boundary and operating rules

This is a narrow, pre-install delta: add one local implementation-worker route, `OpenCode -> Ollama -> configured Qwen`, while retaining the existing cloud Codex/Luna route. It is not a generic provider platform. The daemon remains a deterministic, non-LLM traffic controller; Independent Reviewer, deterministic merge gates, PLAN_CONFLICT/REQUIREMENT_CONFLICT handling, and Terra authority do not change.

Every implementation task remains subject to the existing Worker -> Independent Reviewer -> deterministic merge flow. A cloud `RATE_LIMIT`/`USAGE_LIMIT`/`QUOTA_LIMIT` is a provider-availability fact: in `auto`, it starts a fresh local invocation from durable facts and latches only that run to local. It is not REWORK, STUCK, Recovery, PLAN_CONFLICT, or a Human Gate when the configured local fallback is healthy. No task may install, load, register, or otherwise mutate a real-host LaunchAgent.

## DAG

```text
AO-27 actual OpenCode/Ollama contract investigation
  -> AO-28 narrow Worker contract + cloud compatibility
      -> AO-29 OpenCode local adapter lifecycle
          -> AO-30 explicit mode/routing + run-local fallback latch
          -> AO-31 read-only 131072 local-stack preflight
              \-> AO-32 integration, durable evidence, reviewer/merge preservation
                    -> AO-33 deterministic fake-adapter whole-delta evidence
                          -> AO-34 non-production real-Qwen pilot / recorded limitation
                                -> AO-35 Final Terra Acceptance
```

Initial READY is **AO-27 only**. The real OpenCode/Ollama contract is intentionally a prerequisite for every implementation change: no guessed flags, session schema, or context setting enters the codebase.

## Tasks

### AO-27 — Inspect the actual OpenCode/Ollama local-worker contract

- State: READY; dependencies: none; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `docs/agent-runs/**`, `docs/runbooks/**`, `test/fixtures/opencode/**` (only a contract fixture captured from non-secret, reproducible facts).
- Non-scope: product source changes; OpenCode/Ollama installation, model pull/configuration mutation, real-Qwen workload, credentials, LaunchAgent operations, generic provider research.
- Completion / acceptance: records the installed/runtime-compatible OpenCode invocation and configuration facts needed by this delta: new/fresh Recovery/resume capability, structured outcome/session/PID/exit behavior, safe termination, durable log behavior, supported rate-limit/failure signals, and the authoritative supported place to establish/validate Ollama Qwen context `131072`. Records version/source evidence and any unavailable fact explicitly; it does not invent Codex UUID/event compatibility.
- Verification / tests: read-only executable/config/help/version inspection where accessible; fixture parse test for captured non-secret observations; `npm test -- opencode-contract` (introduced with its fixture), `npm run build`, `npm run lint`.
- Assumptions: the local stack can be inspected directly or through its installed documentation without changing host state.
- Invariants: shell interpretation stays disabled; no secret/private reasoning enters evidence; an unavailable or incompatible fact is recorded as a fail-closed prerequisite, never guessed or silently downgraded.

### AO-28 — Introduce the narrow implementation-Worker contract and retain cloud behavior

- State: PLANNED; dependencies: AO-27; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/worker/**`, `src/luna/**`, `src/codex/**`, `src/config/**`, `src/checkpoint/**`, `test/worker.test.ts`, `test/luna.test.ts`, `test/codex-lifecycle.test.ts`, `test/config.test.ts`, `prompts/luna-implementation-task.md`.
- Non-scope: OpenCode process implementation, routing/mode selection, Ollama calls, reviewer-provider routing, generic N-provider registry, LaunchAgent changes.
- Completion / acceptance: creates only the contract needed by the controller for fresh, resumable, fresh-Recovery, observation, durable logs, and safe retirement; adapts the existing cloud Codex/Luna path to it without changing its configured default behavior. Primary/Recovery remain roles distinct from provider.
- Verification / tests: fake cloud adapter proves new/resume/recovery/outcome/cleanup compatibility and existing Luna/Codex regression; `npm test -- worker luna codex-lifecycle config`, `npm run build`, `npm run lint`.
- Assumptions: AO-27 provides the minimum local lifecycle facts needed to avoid Codex-shaped leakage into the contract.
- Invariants: legacy cloud configurations remain valid and select cloud; no hidden implementation history is needed for Recovery; daemon gains no semantic judgment; reviewer independence and deterministic merge gates remain unchanged.

### AO-29 — Implement the OpenCode local-worker adapter lifecycle

- State: PLANNED; dependencies: AO-28; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/opencode/**`, `src/worker/**`, `src/config/**`, `src/checkpoint/**`, `test/opencode.test.ts`, `test/fixtures/opencode/**`, `test/worker.test.ts`, `test/config.test.ts`.
- Non-scope: direct Ollama agent harness, model-specific Qwen business logic, global routing/latch policy, production model invocation, LaunchAgent operations.
- Completion / acceptance: provides `OpenCodeWorkerAdapter` using the AO-27 contract with shell disabled, fresh Task and fresh durable-evidence Recovery invocation, resume only when safely supported, machine-readable outcome parsing where available, PID/exit/non-zero/spawn/crash classification, session capture, durable logs, and retirement cleanup. The configured model remains configuration, not a `Qwen38WorkerAdapter` constant.
- Verification / tests: fake executable/process fixtures prove new, supported resume, fresh Recovery, non-zero/spawn/crash propagation, session capture, log/retirement behavior, and no shell command construction; `npm test -- opencode worker config`, `npm run build`, `npm run lint`.
- Assumptions: AO-27 identifies one supported, non-mutating process/config contract; fake fixtures can represent its relevant facts.
- Invariants: no credentials/private conversation are persisted; unsupported resume fails explicitly rather than pretending Codex behavior; Recovery receives durable evidence only.

### AO-30 — Add explicit cloud/local/auto routing and the run-local fallback latch

- State: PLANNED; dependencies: AO-29; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `src/config/**`, `src/controller/**`, `src/scheduler/**`, `src/reconcile/**`, `src/checkpoint/**`, `src/logging/**`, `src/worker/**`, `test/config.test.ts`, `test/controller.test.ts`, `test/scheduler.test.ts`, `test/reconcile.test.ts`, `test/checkpoint.test.ts`.
- Non-scope: semantic/per-Task model selection, provider scoring/load balancing, cloud-to-local-to-cloud oscillation, reviewer routing framework, UI, LaunchAgent operations.
- Completion / acceptance: operator configuration selects exactly `cloud`, `local`, or `auto`, validates explicit Primary/Recovery provider choices fail-closed, and retains existing cloud defaults when local is not opted in. `auto` starts cloud, recognizes only explicit cloud rate/usage/quota outcomes, persists a provider-fallback fact, starts the affected Task in a fresh local session from durable evidence, and latches subsequent implementation Tasks for that run to local. A new run resets to configured mode. Local unavailability records durable failure and stops without loop; normal cloud crash/test failure does not switch provider.
- Verification / tests: fake adapters prove all modes, Primary/Recovery combinations, rate-limit fallback, same-run latch, new-run reset, no repeated cloud probe, unavailable-local fail-closed, and explicit invalid-config rejection; `npm test -- config controller scheduler reconcile checkpoint`, `npm run build`, `npm run lint`.
- Assumptions: AO-28/AO-29 expose stable provider-neutral lifecycle observations and durable evidence inputs.
- Invariants: rate-limit fallback consumes neither REWORK cycle nor Recovery budget and is not PLAN_CONFLICT/Human Gate when healthy fallback exists; provider and role stay separate; no daemon semantic inference.

### AO-31 — Add read-only local-stack preflight for Qwen context 131072

- State: PLANNED; dependencies: AO-29; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `src/opencode/**`, `src/config/**`, `src/cli/**`, `src/logging/**`, `test/opencode.test.ts`, `test/config.test.ts`, `test/entrypoint.test.ts`, `docs/runbooks/agent-orchestrator.md`, `docs/runbooks/agent-orchestrator-config.example.yaml`.
- Non-scope: installing/updating OpenCode or Ollama, pulling/changing a model, writing machine-local model configuration, task execution, production mutation, LaunchAgent operations.
- Completion / acceptance: adds an explicit non-mutating local preflight that validates executable/path/workdir, OpenCode availability, Ollama endpoint, configured model identifier/availability, required local configuration, and supported establishment/validation of context exactly `131072`. It reports provider-neutral non-secret evidence and fails closed if any prerequisite is unavailable/incompatible; it never reduces context to start work.
- Verification / tests: fake OpenCode/Ollama fixtures cover every pass/fail prerequisite and prove no process mutation/LaunchAgent call; runbook/config validation; `npm test -- opencode config entrypoint`, `npm run build`, `npm run lint`.
- Assumptions: AO-27 identifies a supported read-only inspection mechanism for the current stack.
- Invariants: model tag is operator configuration; preflight has no write/install/pull/network-side-effect path beyond read-only local availability inspection; `131072` cannot be silently substituted.

### AO-32 — Integrate local routing with durable evidence and unchanged review/merge authority

- State: PLANNED; dependencies: AO-30, AO-31; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `src/cli/**`, `src/controller/**`, `src/checkpoint/**`, `src/reconcile/**`, `src/validation/**`, `src/logging/**`, `src/worker/**`, `src/luna/**`, `src/opencode/**`, `test/cli.test.ts`, `test/controller.test.ts`, `test/checkpoint.test.ts`, `test/reconcile.test.ts`, `test/validation.test.ts`, `docs/runbooks/agent-orchestrator.md`, `prompts/luna-implementation-task.md`.
- Non-scope: new reviewer provider, Terra normal-task review/merge, task-board authority changes, generalized workflow platform, host installation.
- Completion / acceptance: composes adapters, routing, preflight, checkpoint/reconcile, and review packet so durable evidence records role, provider/adapter, configured local model when used, branch/HEAD/session/process outcome, fallback/latch, tests, reviewer result, STUCK and Recovery facts without secrets. Local work reaches the same Independent Reviewer and deterministic merge gates as cloud work; fallback remains a fresh local route rather than Recovery.
- Verification / tests: integration fixtures prove cloud and local pass through identical reviewer/merge checks, provider-neutral evidence, recovery-role selection independent of fallback, and no Terra ordinary-task call; `npm test -- cli controller checkpoint reconcile validation`, `npm run build`, `npm run lint`.
- Assumptions: AO-30 has deterministic routing decisions and AO-31 exposes a read-only preflight result usable before local dispatch.
- Invariants: Terra remains Planning / confirmed Plan Revision / Final Acceptance only; reviewer is independent/read-only with no implementation history; deterministic merge retains reviewed-HEAD and all existing gates.

### AO-33 — Prove the delta with deterministic fake-adapter acceptance evidence

- State: PLANNED; dependencies: AO-32; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `test/**`, `scripts/pilot/**`, `docs/agent-runs/**`, `docs/runbooks/agent-orchestrator.md`.
- Non-scope: production `/slot` data/runtime/Scheduler, real model configuration, source feature expansion outside test seams, deployment, LaunchAgent install/load/register.
- Completion / acceptance: produces durable disposable-fixture evidence for every 2026-09-03 deterministic acceptance: cloud regression; OpenCode new/resume/fresh Recovery/failure; cloud/local/auto; role/provider selection; rate-limit-to-local fresh fallback and latch/reset; separation from REWORK/STUCK/Recovery; unavailable local fail-closed; `131072` preflight; provider-neutral evidence; independent review/deterministic merge; and zero host mutation.
- Verification / tests: focused fake-adapter suite plus `npm test`, `npm run build`, `npm run lint`, `packaging/launchd/manage.sh verify`; all pilot paths use disposable fixtures only.
- Assumptions: AO-32 makes every external boundary injectable without requiring a real host or model.
- Invariants: no test calls `launchctl`, `manage.sh install`, or real `/slot` operational work; tests do not declare real local-stack compatibility merely from fakes.

### AO-34 — Run the safe non-production Qwen pilot or record the inaccessible-host limitation

- State: PLANNED; dependencies: AO-33; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `scripts/pilot/**`, `docs/agent-runs/**`, `docs/runbooks/agent-orchestrator.md`, `test/pilot.test.ts`.
- Non-scope: production `/slot` runtime/data/Scheduler, deploy/publication, model installation/configuration changes, LaunchAgent install/load/register, source-code fixes.
- Completion / acceptance: runs and records read-only local-stack preflight when the Mac/local stack is accessible; then, only if safely accessible, executes one bounded disposable/non-production repository task through OpenCode/Ollama/Qwen and records contract-compatible evidence. If the physical/local host is inaccessible, records the precise limitation and leaves real-Qwen pilot as an explicit Final Acceptance validation item rather than PASS by assumption.
- Verification / tests: `npm test -- pilot`, `npm test`, `npm run build`, `npm run lint`, `packaging/launchd/manage.sh verify`; evidence identifies the exact disposable target or the inaccessible-host result.
- Assumptions: AO-33 fake evidence passes before any real-stack attempt; a safe disposable target exists if the local host is reachable.
- Invariants: preflight is read-only; pilot never touches production `/slot`, external consequential systems, or LaunchAgent lifecycle; inability to reach hardware is not a code failure and does not authorize host mutation.

### AO-35 — Final Terra Acceptance of the Qwen/OpenCode worker delta

- State: PLANNED; dependencies: AO-34; parallel: EXCLUSIVE; Human Gate: none unless the result is `REQUIREMENT_CONFLICT`.
- Scope / allowed paths: `docs/agent-runs/**`, `docs/task-boards/**`, `tasks/agent-orchestrator-qwen-opencode-worker-preinstall-delta.yaml`, `test/final-acceptance.test.ts`.
- Non-scope: code fixes, normal implementation review/merge, changing canonical requirements, host install, production mutation.
- Completion / acceptance: Terra rechecks the whole product against the 2026-09-03 HANDOFF and records PASS, scoped corrective-task REWORK, or REQUIREMENT_CONFLICT. It verifies legacy cloud compatibility; local 131072 fail-closed preflight; routing/latch and recovery separation; review/merge/Terra authority; fake evidence; and the real-stack/pilot result or explicit limitation. Only PASS with required pre-install evidence leaves AO-16 host install as a separate operator Human Gate.
- Verification / tests: `npm test -- final-acceptance`, `npm test`, `npm run build`, `npm run lint`, `packaging/launchd/manage.sh verify`, and review of AO-33/AO-34 evidence.
- Assumptions: all upstream tasks are independently reviewed/merged with no unresolved Human Gate; any unavailable real host is documented by AO-34.
- Invariants: Final Terra Acceptance is whole-product acceptance, never a code fix; corrective work is newly scoped through Worker -> Independent Reviewer -> deterministic merge; real-host LaunchAgent install remains unexecuted.

## Initial parallelism and gates

There are no parallel implementation roots: AO-27 is deliberately the sole initial READY task because it establishes the real local-stack contract. After AO-28, AO-30 and AO-31 are both dependency-safe but are marked EXCLUSIVE because their narrow changes overlap central configuration/adapter seams; the plan favors deterministic integration over artificial concurrency. All remaining stateful integration, evidence, pilot, and acceptance work is EXCLUSIVE. No task has a predeclared Human Gate. Runtime Human Gates remain only `REQUIREMENT_CONFLICT`, automatic recovery exhausted, or a separately predeclared consequential operation; AO-16 real-host installation remains that separate operator gate.

## Consistency audit (Planning Terra, 2026-09-03)

| Audit | Result |
|---|---|
| Requirements ↔ task scope | PASS — AO-27 resolves real OpenCode/Ollama facts; AO-28–AO-32 own the narrow adapter, modes, latch, preflight, durable facts, and authority preservation; AO-33–AO-35 own evidence/pilot/final acceptance. |
| Simultaneous acceptance | PASS — cloud fallback is provider availability, while REWORK/STUCK/Recovery retain distinct role/budget paths; context is exactly 131072 or fail-closed. |
| Dependencies / cycles | PASS — every edge points upstream from investigation through adapter/routing/preflight, integration, deterministic proof, pilot, and final acceptance; no cycle. |
| Scope sufficient / non-scope feasible | PASS — each completion criterion has allowed source/test/doc paths; no task needs UI, generic provider routing, direct Ollama harness, production mutation, or LaunchAgent installation. |
| Assumptions / invariants | PASS — unknown local-host availability becomes explicit evidence rather than a contradictory success condition; all tasks preserve no-secret durability, independent review, deterministic merge, and Terra-only plan authority. |
| SAFE / EXCLUSIVE | PASS — contract/refactor task is isolated; central routing/preflight and stateful evidence/pilot/final acceptance are serialized. |
| Completed work | PASS — AO-01–AO-26 are prerequisites/baseline only. This board starts at AO-27 and does not reimplement their accepted lifecycle, reviewer, merge, LaunchAgent packaging, or prior final acceptance. |

Real-host LaunchAgent install confirmation: **not performed by this planning task or any planned implementation task.**
