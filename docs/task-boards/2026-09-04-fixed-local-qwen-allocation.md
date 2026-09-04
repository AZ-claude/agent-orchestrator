# Agent Orchestrator — fixed local-Qwen allocation task-board

Updated: 2026-09-04 JST  
Planning authority: **Terra**  
Canonical allocation directive: user instruction of 2026-09-04; it supplements the Qwen/OpenCode delta handoff and supersedes any conflicting local-model allocation default.

## Objective and boundary

Fix ownership of the one local Ollama inference lane on this 48-GB host:

| Workload owner | Fixed model | Context | Invocation boundary |
|---|---|---:|---|
| `/kiji` date/time work | `qwen3.6:35b` | `262144` | its existing Ollama client |
| Agent Orchestrator local implementation work | `qwen3.8:latest` (the installed Qwen3.8-27B) | `262144` | OpenCode -> Ollama |

This is **not** per-task semantic model routing. Each owning application has one fixed local model. Because `OLLAMA_MAX_LOADED_MODELS=1` and `OLLAMA_NUM_PARALLEL=1`, both applications must use one common host lease before invoking Ollama; the holder alone may load/infer with its assigned model. The lease is released after the bounded invocation, including failure cleanup, so the next owner may switch models. `OLLAMA_KEEP_ALIVE=-1` may retain the last model while idle, but does not grant concurrent residency or bypass the lease.

AO-01 through AO-35 are accepted baseline and are not recreated. In particular, the existing AO Qwen3.8 adapter, cloud/local/auto routing, rate-limit latch, reviewer independence, deterministic merge, and 262144 read-only preflight remain baseline behavior.

YAGNI boundary: no generic multi-provider platform, dynamic model optimization, UI, model scoring, background preload daemon, model eviction policy, or providers beyond the two fixed assignments. No task may install/load/register the real-host **Agent Orchestrator** LaunchAgent.

## DAG

```text
AO-36 fixed allocation and host-lease contract
  ├─> AO-37 AO Qwen3.8 binding + read-only preflight
  ├─> AO-38 AO shared-lease enforcement and lifecycle evidence
  └─> AO-39 /kiji Qwen3.6 + shared-lease adoption [Human Gate]
          AO-37 + AO-38 + AO-39
                    └─> AO-40 deterministic cross-client fake acceptance
                              └─> AO-41 disposable real-host handoff pilot
                                        └─> AO-42 Final Terra Acceptance
```

Initial READY: **AO-36 only**. After AO-36, AO-37 and AO-38 are parallel SAFE. AO-39 is blocked at its explicit cross-repository Human Gate. AO-40 onward is EXCLUSIVE because it proves or operates the shared host boundary.

## Tasks

### AO-36 — Define the fixed allocation and common local-Qwen lease contract

- State: READY; dependencies: none; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `docs/task-boards/**`, `docs/runbooks/**`, `tasks/agent-orchestrator-fixed-local-qwen-allocation.yaml`, `test/fixtures/**`.
- Non-scope: implementation source, Ollama/LaunchAgent mutation, `/kiji` source changes, real inference, generic arbitration/queue framework, changing AO-01–AO-35.
- Completion / acceptance: records one versioned, non-secret contract: exact owner/model/context mapping; an operator-configured absolute shared lease location; acquisition-before-any-Ollama-request, exclusive hold through invocation/cleanup, release-on-all-terminal-paths, stale-owner/process-death recovery, bounded wait/observable busy result, and durable owner/model/lease outcome facts. It specifies that neither client may change the other client's model or configuration.
- Verification / tests: contract fixture parse/consistency test; `npm test -- config manifest && npm run build && npm run lint`.
- Assumptions: the host remains intentionally limited to one loaded model and one concurrent local inference; both client implementations can use a filesystem-safe host-local lease primitive.
- Invariants: `qwen3.6:35b` is reserved for `/kiji` date/time work and Qwen3.8-27B for AO local work; context is exactly 262144; no prompt, source content, credential, or private reasoning is put into lease evidence; no model selection is inferred from task text.

### AO-37 — Bind Agent Orchestrator local execution to Qwen3.8-27B and preflight it read-only

- State: PLANNED; dependencies: AO-36; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/config/**`, `src/opencode/**`, `src/cli/**`, `docs/runbooks/**`, `test/config.test.ts`, `test/opencode.test.ts`, `test/entrypoint.test.ts`.
- Non-scope: `/kiji` code/configuration, cloud worker behavior, changing Primary/Recovery or rate-limit fallback semantics, direct Ollama generation, model pull/change, LaunchAgent operation, generic provider registry.
- Completion / acceptance: AO's local profile validates and invokes only `ollama/qwen3.8:latest` backed by the installed Qwen3.8-27B, with configured context 262144. Its read-only preflight verifies the exact configured model, OpenCode config, Ollama model capability at least 262144, and persistent Ollama service context 262144; absent/mismatched facts fail closed before dispatch. Existing Luna/Codex cloud configurations remain backward compatible.
- Verification / tests: fake OpenCode/Ollama tests reject Qwen3.6, other model tags, 32K, missing/namespaced capability, and unavailable service; retain cloud/local/auto regression; `npm test -- config opencode entrypoint controller && npm run build && npm run lint`.
- Assumptions: `qwen3.8:latest` continues to resolve to the locally installed Qwen3.8-27B; a model capability is an upper bound, not proof of an active request context.
- Invariants: preflight is read-only and never pulls, unloads, loads, or edits Ollama; AO's cloud rate-limit fallback remains a fresh local Qwen3.8 route and stays distinct from REWORK/STUCK/Recovery; reviewer independence, deterministic merge, and Terra authority do not change.

### AO-38 — Enforce the common host lease around AO local OpenCode work

- State: PLANNED; dependencies: AO-36; parallel: SAFE; Human Gate: none.
- Scope / allowed paths: `src/opencode/**`, `src/worker/**`, `src/controller/**`, `src/checkpoint/**`, `src/reconcile/**`, `src/logging/**`, `src/config/**`, `test/opencode.test.ts`, `test/worker.test.ts`, `test/controller.test.ts`, `test/reconcile.test.ts`, `test/fixtures/**`.
- Non-scope: `/kiji` implementation, global job queue, priority scheduler, concurrent local workers, automatic model switching/preloading, direct Ollama model management, LaunchAgent lifecycle.
- Completion / acceptance: every AO local OpenCode invocation (explicit local and auto rate-limit fallback) acquires the AO-36 lease before process spawn and holds it until the child and retirement cleanup reach a terminal state. Busy, timeout, malformed, or stale lease facts are durable and fail/await deterministically without consuming REWORK or Recovery budget. Crash/reconcile releases only a safely identifiable stale AO owner; no path releases another client owner.
- Verification / tests: deterministic fake lock/process tests cover acquire, contention, bounded wait, release on success/non-zero/spawn failure/cancel, crash reconciliation, stale-own-owner recovery, and foreign-owner non-release; existing cloud and reviewer/merge tests remain green; `npm test -- opencode worker controller reconcile checkpoint && npm run build && npm run lint`.
- Assumptions: the common lease primitive can atomically distinguish its owner and safely recover a demonstrably dead owner on the same host.
- Invariants: at most one AO local inference is active; AO never invokes Qwen3.6 or alters `/kiji` state; rate-limit fallback does not become Recovery; lease metadata remains non-secret and cannot alter task-board/DAG meaning.

### AO-39 — Adopt the Qwen3.6 and common-lease contract in `/kiji` date/time work

- State: PLANNED; dependencies: AO-36; parallel: EXCLUSIVE; Human Gate: **required — explicit authorization and review in the separate `/kiji` repository before any source/configuration change**.
- Scope / allowed paths: `/Users/eita/projects/kiji/src/kiji/draft/**`, `/Users/eita/projects/kiji/test/**`, `/Users/eita/projects/kiji/docs/**`, and its non-secret operator configuration/example paths only after the Human Gate.
- Non-scope: Agent Orchestrator source, `/kiji` production databases, scheduler registration/retargeting, raw session history, non-date/time workloads, Qwen3.8 use, a second lease protocol, model pull/load/unload operations.
- Completion / acceptance: `/kiji` date/time Qwen invocation uses only `qwen3.6:35b`, explicitly requests context 262144, validates configuration without falling back to its current 32K default, and acquires/releases exactly the AO-36 lease around the request. Its configuration errors and host-lane busy outcome are explicit and non-destructive; existing non-Qwen and deterministic paths retain their behavior.
- Verification / tests: `/kiji` fake Ollama/lease tests prove fixed model, 262144 request, 32K rejection, contention/no-request-before-acquire, terminal release, foreign-owner protection, and existing provider regression; its repository's focused test command plus full relevant suite.
- Assumptions: the separate `/kiji` review process accepts the shared host contract and exposes a safe injection seam; no production Scheduler or database operation is necessary to validate it.
- Invariants: no production data or Task Scheduler mutation; no silent `KIJI_OLLAMA_NUM_CTX=32768` fallback; `/kiji` never selects Qwen3.8; its lease implementation interoperates byte-for-byte with AO-36 rather than approximating it.

### AO-40 — Prove fixed allocation and contention behavior with deterministic cross-client fakes

- State: PLANNED; dependencies: AO-37, AO-38, AO-39; parallel: EXCLUSIVE; Human Gate: none.
- Scope / allowed paths: `test/**`, `scripts/pilot/**`, `docs/agent-runs/**`, `docs/runbooks/**`, `tasks/agent-orchestrator-fixed-local-qwen-allocation.yaml` plus the approved `/kiji` fixture/evidence paths from AO-39.
- Non-scope: real model inference, production data, Scheduler changes, source feature expansion beyond test seams, model-management commands, LaunchAgent install/load/register.
- Completion / acceptance: disposable fakes demonstrate that AO selects only Qwen3.8 and `/kiji` date/time work only Qwen3.6, each requests 262144, exactly one cross-client lease holder can invoke Ollama, second caller waits/fails observably without a request, terminal/stale-owner recovery is safe, and AO cloud/Codex/Luna/review/merge/rate-limit semantics remain unchanged.
- Verification / tests: AO focused suites and `npm test && npm run build && npm run lint && packaging/launchd/manage.sh verify`; `/kiji` approved relevant full suite; evidence contains no real prompts or raw histories.
- Assumptions: AO-39 supplies a compatible `/kiji` fake client and contract fixture.
- Invariants: fake proof is not a claim that two models can reside concurrently; no test invokes `launchctl`, changes Ollama configuration, or touches real `/kiji` data.

### AO-41 — Run a disposable real-host handoff pilot and restore the nominated idle model

- State: PLANNED; dependencies: AO-40; parallel: EXCLUSIVE; Human Gate: **required — operator approves the bounded non-production `/kiji` pilot target and the post-pilot idle-model choice**.
- Scope / allowed paths: `scripts/pilot/**`, `docs/agent-runs/**`, `docs/runbooks/**`, and a disposable `/kiji` test target approved at the gate.
- Non-scope: production `/kiji` data/Scheduler, source-code fixes, model installation, permanent Ollama configuration changes, concurrent inference, Agent Orchestrator LaunchAgent operations.
- Completion / acceptance: after read-only preflight, executes one bounded disposable `/kiji` Qwen3.6 request and one bounded disposable AO/OpenCode Qwen3.8 request through the common lease, records that they did not overlap, records 262144 for each, and restores the operator-nominated model as the sole loaded idle model. If the host cannot safely perform a step, records the exact limitation and leaves Final Acceptance non-PASS.
- Verification / tests: AO pilot test plus `npm test && npm run build && npm run lint && packaging/launchd/manage.sh verify`; `/kiji` pilot verification; read-only `ollama ps`/service-config evidence before and after.
- Assumptions: AO-40 passes, both models are already installed, and the operator supplies a disposable `/kiji` target and idle-model choice.
- Invariants: no production request, data mutation, model pull, context downgrade, or LaunchAgent lifecycle operation; no test/pilot treats residency of both models as supported.

### AO-42 — Final Terra Acceptance of fixed local-Qwen allocation

- State: PLANNED; dependencies: AO-41; parallel: EXCLUSIVE; Human Gate: none unless a requirement conflict is found.
- Scope / allowed paths: `docs/agent-runs/**`, `docs/task-boards/**`, `tasks/agent-orchestrator-fixed-local-qwen-allocation.yaml`.
- Non-scope: code fixes, normal implementation review/merge, changing fixed assignment, model installation/configuration mutation, production operations, LaunchAgent install.
- Completion / acceptance: Terra records PASS only when the exact fixed mapping, 262144 preflights, shared capacity-one lease, 32K prevention, cross-client fake proof, safe real-host pilot/restoration, legacy Luna/Codex compatibility, rate-limit/REWORK/STUCK/Recovery separation, and reviewer/deterministic-merge/Terra authority evidence all agree. Otherwise records scoped REWORK or REQUIREMENT_CONFLICT.
- Verification / tests: review AO-36–AO-41 evidence; `npm test && npm run build && npm run lint && packaging/launchd/manage.sh verify`; approved `/kiji` verification evidence.
- Assumptions: all upstream implementation and `/kiji` review artifacts are accepted without unresolved Human Gates.
- Invariants: final acceptance never fixes code; Terra remains planning, confirmed plan revision, and final acceptance authority only; real-host Agent Orchestrator LaunchAgent install remains unexecuted.

## Consistency audit (Planning Terra, 2026-09-04)

| Audit | Result |
|---|---|
| Requirements ↔ scope | PASS — AO-36 defines the exact two-owner contract; AO-37/38 own AO binding and enforcement; AO-39 owns the only `/kiji` change; AO-40–42 prove and accept the whole product. |
| Acceptance compatibility | PASS — fixed allocation and 262144 do not alter cloud mode, Primary/Recovery, rate-limit latch, or review/merge authority; one lease makes the 48-GB, one-loaded-model limitation explicit. |
| Dependencies / cycles | PASS — a single root leads to independent AO branches and gated `/kiji` adoption, then proof, pilot, and final acceptance; no cycle or omitted cross-repository dependency. |
| Scope / non-scope | PASS — each completion item has allowed paths. `/kiji` production/Scheduler/data changes and all model-management operations are excluded. |
| Assumptions / invariants | PASS — 256K is an explicit request, while 32K is a fail-closed error; the lease controls contention but does not claim two-model residency or turn an inactive disk model into loaded memory. |
| SAFE / EXCLUSIVE | PASS — after contract definition, AO binding and AO lease work have separable seams and are SAFE; cross-client evidence, real host work, and final acceptance are serialized. |
| No reimplementation | PASS — AO-01–AO-35 are baseline only; this board adds only fixed ownership and cross-client capacity-one coordination. |

Real-host Agent Orchestrator LaunchAgent install: **not planned and not performed**.
