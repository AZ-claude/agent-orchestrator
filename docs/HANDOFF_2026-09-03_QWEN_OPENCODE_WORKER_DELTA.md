# Agent Orchestrator — Qwen/OpenCode Worker pre-install delta HANDOFF

Updated: 2026-09-03 JST  
Status: **REQUIREMENTS COMPLETE — Planning Terra による差分 task-board / DAG 作成待ち**

## 0. Authority and precedence

This document is the canonical requirements delta for adding a local Qwen worker path before real-host installation of Agent Orchestrator.

Read together with:

- `docs/HANDOFF_2026-09-02_AGENT_ORCHESTRATOR_PREINSTALL_DELTA.md`
- `docs/task-boards/2026-09-02-agent-orchestrator-preinstall-delta.md`
- `tasks/agent-orchestrator-preinstall-delta.yaml`
- `docs/HANDOFF_2026-08-31_AGENT_ORCHESTRATOR_V1_REQUIREMENTS.md`
- `docs/DESIGN_2026-08-31_AGENT_ORCHESTRATOR_V1.md`

Where this HANDOFF conflicts with older worker/provider assumptions, this HANDOFF wins. All non-conflicting safety, authority, review, merge, recovery, Human Gate, lifecycle, and YAGNI rules remain in force.

Current accepted baseline before this delta: `91f8098c7966caa2eda6f4788425a3ff39b1ff00` (`docs: record AO-26 independent acceptance`).

**Real-host LaunchAgent installation remains blocked until this delta is implemented and final-accepted. Do not install/load/register the LaunchAgent while implementing this delta.**

---

## 1. Goal

Add a second, local implementation-worker path so Agent Orchestrator can execute Tasks through:

```text
Agent Orchestrator
  ├─ cloud worker: existing Luna/Codex path
  └─ local worker: OpenCode -> Ollama -> Qwen
```

The first supported local model is the user's existing **Qwen3.8-27B** setup, invoked through **OpenCode**, backed by **Ollama**, with an intended fixed context window of **128K / 131072 tokens**.

The user must be able to choose whether work runs on cloud or local workers. Qwen3.8 is materially slower than Luna/Codex, so the orchestrator must never silently force all normal work onto Qwen merely because Qwen support exists.

The system should also support a practical cloud-quota fallback: normal work may begin on Luna/Codex and, if a real cloud rate/usage/quota limit is detected, the current run can switch to local Qwen and continue without repeatedly retrying the exhausted cloud provider.

---

## 2. Required worker modes

Support three simple execution modes. Exact config names may differ, but semantics must be stable and explicit.

### `cloud`

- Primary and Recovery implementation workers use the existing Luna/Codex path.
- Local Qwen is not selected automatically.
- Existing behavior remains backward compatible.

### `local`

- Implementation work is executed through OpenCode -> Ollama -> configured local Qwen model.
- This mode exists so the user can intentionally avoid cloud limits/cost/availability and delegate all implementation work to the local model.
- Independent Reviewer, deterministic merge gates, PLAN_CONFLICT, REQUIREMENT_CONFLICT, Human Gate, scope, assumptions, invariants, durable evidence, and lifecycle rules remain unchanged.

### `auto`

- Start with the configured cloud worker by default.
- On a genuine cloud rate/usage/quota-limit outcome, switch the **remainder of that orchestrator run** to local mode.
- The switch is latched for that run. Do not probe the exhausted cloud provider again for every subsequent Task.
- A new future run starts from its configured mode again; the fallback latch is not a permanent global preference unless explicitly configured by the user.

The user must also be able to configure Primary and Recovery worker choices explicitly where useful, without introducing a general-purpose semantic model router.

Examples of intended configurations:

```text
mode=cloud
primary=cloud
recovery=cloud
```

```text
mode=local
primary=local
recovery=local
```

```text
mode=auto
primary=cloud
recovery=local
```

Exact schema is a design decision, but behavior must remain small, deterministic, and operator-selectable.

---

## 3. Provider/adapter boundary

Do not implement a Qwen-specific monolith inside existing `LunaRunner`.

Refactor only as much as needed to create a narrow implementation-worker contract that can be satisfied by:

1. the existing Codex/Luna adapter; and
2. a new OpenCode adapter.

The local adapter should conceptually be **OpenCodeWorkerAdapter**, not `Qwen38WorkerAdapter`, because OpenCode is the process/session boundary the orchestrator controls and the model is configuration.

The orchestrator must not need to know Ollama's model internals beyond configuration/preflight facts needed for safe execution.

Do not build a generic multi-provider marketplace/router. Supporting the existing cloud adapter plus one local OpenCode adapter is sufficient for this delta.

---

## 4. OpenCode / Ollama / Qwen requirements

Before implementation, Planning/implementation work must inspect the actual installed/runtime-compatible OpenCode and Ollama invocation/configuration contract rather than guessing CLI flags or session formats.

The local worker path must support the lifecycle capabilities required by Agent Orchestrator:

- fresh Task invocation;
- fresh Recovery invocation from durable evidence only;
- resume of a resumable local session where OpenCode safely supports it;
- structured/machine-readable outcome parsing where supported;
- process PID/exit observation;
- non-zero failure propagation;
- crash/spawn failure classification;
- durable log output;
- session identifier capture when available;
- safe termination/cleanup of RETIRED sessions/processes.

If OpenCode's real lifecycle differs from Codex, normalize only the facts Agent Orchestrator actually needs. Do not force OpenCode to mimic Codex-specific UUID/event schemas internally.

Shell interpretation must remain disabled for process spawning. Arguments/config values must not be concatenated into an unsafe shell command.

---

## 5. Model configuration and 128K context

The first local production configuration is Qwen3.8-27B through Ollama/OpenCode.

The intended context is fixed at **131072 tokens (128K)**.

This delta must investigate where the authoritative context setting belongs in the actual OpenCode + Ollama setup and then implement a deterministic preflight that can establish that the configured local execution path is compatible with the intended context.

At minimum, local-worker preflight must fail closed when required local prerequisites are unavailable or clearly incompatible, including as applicable:

- OpenCode executable unavailable;
- Ollama/local endpoint unavailable;
- configured model unavailable;
- invalid/missing model identifier;
- required local configuration missing;
- intended 131072 context configuration cannot be established/validated using the supported local stack;
- working directory or required executable paths invalid.

Do not silently reduce the context window to make the worker start.

Do not embed secrets, private reasoning, or machine-specific credentials into repository-tracked config/evidence.

The exact Ollama model name/tag is operator configuration, not a hard-coded repository constant unless an existing checked-in test fixture needs a fake value.

---

## 6. Rate-limit fallback semantics

The existing cloud path already distinguishes rate-limit style outcomes. Preserve and generalize that behavior at the worker-routing boundary.

A cloud rate-limit fallback is an infrastructure/provider availability event, **not** an implementation REWORK/STUCK event.

Therefore:

- it must not consume normal Reviewer REWORK budget;
- it must not consume Recovery Worker budget merely because the provider was rate-limited;
- it must not be classified as PLAN_CONFLICT;
- it must not become a Human Gate when a configured healthy local fallback exists.

For `auto` mode:

```text
cloud worker
  -> RATE_LIMIT / USAGE_LIMIT / QUOTA_LIMIT
  -> persist provider-fallback fact
  -> latch this run to local
  -> continue the affected Task using a fresh local worker from durable task evidence
  -> subsequent implementation Tasks in this run use local
```

Do not transfer hidden cloud reasoning/history into the fresh local worker. Use only durable task facts/evidence.

If local fallback is configured but local preflight/runtime is unavailable, fail closed with durable evidence. Do not loop cloud <-> local indefinitely.

A normal cloud crash or code/test failure is not automatically a reason to switch providers. Provider fallback should be triggered only by explicitly supported availability/quota conditions unless the operator selected `local`.

---

## 7. Primary / Recovery behavior

Worker provider choice must remain separate from worker role.

Conceptually:

```text
role: Primary | Recovery
provider: cloud | local
```

Examples that must be representable:

- Primary cloud / Recovery cloud
- Primary local / Recovery local
- Primary cloud / Recovery local

Normal REWORK/STUCK rules from the 2026-09-02 HANDOFF remain authoritative:

- same Primary session for ordinary bounded REWORK where resumable;
- early STUCK on repeated normalized finding/test failure or simple diff oscillation;
- fresh Recovery context/session;
- Recovery receives durable evidence, not old hidden reasoning;
- Recovery also requires Independent Reviewer approval and deterministic gates.

Do not assume that `Recovery=local` means every cloud rate limit should consume the Recovery budget; rate-limit fallback is a separate route as defined above.

---

## 8. Independent Reviewer and Terra remain unchanged

Adding Qwen does not weaken semantic review.

Every implementation Task, regardless of cloud/local provider, must still pass the Independent Reviewer contract and deterministic merge gates.

The reviewer must remain independent/read-only and receive no implementation reasoning/history.

This delta does not reintroduce normal per-task Terra review or Terra merge.

Terra remains limited to:

- Planning;
- reviewer-confirmed PLAN_CONFLICT plan revision; and
- whole-product Final Acceptance.

Whether the Independent Reviewer itself should be local is **not part of this delta unless required by existing implementation constraints**. The immediate goal is local implementation-worker capability, not an all-agent provider-routing framework.

---

## 9. Durable evidence and observability

Durable checkpoint/evidence must be provider-neutral enough to explain what happened without relying on the session itself.

Record at least, where applicable:

- Task ID;
- worker role (Primary/Recovery);
- worker provider/adapter (`cloud` or `local` / equivalent stable identifier);
- configured local model identifier when local was used;
- branch / HEAD;
- session ID if available;
- process outcome;
- rate-limit/provider fallback event;
- whether run-local fallback latch is active;
- machine validation/test results;
- Reviewer result;
- failure/STUCK reason;
- Recovery takeover fact.

Do not store private chain-of-thought, secrets, full hidden provider conversations, or credentials as durable evidence.

Logs should make it possible for the operator to answer: "which Tasks used Luna, which used Qwen, why did routing change, and where did execution stop?"

---

## 10. Configuration and operator control

Worker mode/provider selection must be explicit and changeable without source-code edits.

The operator must be able to choose local/cloud/auto before a run.

Keep configuration minimal. Do not create per-Task semantic routing rules, benchmark-based automatic model selection, cost optimizers, or a UI.

Invalid combinations must fail closed with a clear validation error rather than silently substituting another provider.

Existing installations/configuration that do not opt into local mode must preserve current cloud behavior.

---

## 11. Pre-install verification / pilot

This delta is intentionally implemented before real-host LaunchAgent installation.

Required evidence should be layered:

### Deterministic/fake tests

Use fake executables/process fixtures to prove at least:

- cloud adapter regression remains green;
- OpenCode new invocation;
- OpenCode resume where supported;
- fresh local Recovery invocation;
- local failure/spawn/crash classification;
- mode selection: cloud/local/auto;
- Primary/Recovery provider selection;
- cloud rate-limit -> local fallback;
- fallback latch applies to subsequent Tasks in the same run;
- new run resets to configured routing mode;
- rate-limit fallback does not consume REWORK/Recovery budget;
- local unavailable -> fail closed, no infinite fallback loop;
- provider-neutral durable evidence;
- no host LaunchAgent mutation.

### Read-only local-stack preflight

Where the current Mac environment is accessible, run a non-mutating preflight for the real OpenCode/Ollama/Qwen3.8 configuration and record durable evidence.

### Real local-worker pilot, if safely accessible before return

If the existing Mac can currently run OpenCode/Ollama/Qwen3.8, perform at least one safe, disposable/non-production implementation-worker pilot proving the local adapter can execute a bounded repository task and produce evidence compatible with the orchestrator contract.

The pilot must not mutate production `/slot` runtime/data/Scheduler, install LaunchAgent, deploy, or perform external consequential actions.

If real Qwen execution is unavailable solely because the physical/local model host cannot be reached while traveling, implementation may still reach code-complete/fake-test-complete status, but that limitation must be recorded explicitly for Final Acceptance rather than guessed away.

---

## 12. Human Gates

Do not add generic Human Gates merely because local AI is involved.

Existing Human Gate taxonomy remains:

1. REQUIREMENT_CONFLICT;
2. automatic implementation recovery exhausted;
3. predeclared materially consequential/production/irreversible/auth operation.

A provider rate limit is not a Human Gate when automatic configured fallback succeeds.

The existing AO-16 real-host LaunchAgent install remains a Human Gate and remains unexecuted during this delta.

---

## 13. YAGNI / explicit non-goals

Do **not** implement in this delta:

- Qwen3.6 routing unless trivially supported by model-as-config without additional behavior;
- direct Ollama agent/tool harness replacing OpenCode;
- LM Studio support;
- arbitrary N-provider plugin marketplace;
- semantic/per-Task automatic model selection;
- benchmark-based routing engine;
- cost/latency optimizer;
- provider load balancer;
- generic failover graph;
- cloud-to-local-to-cloud oscillating retries;
- dashboard/UI;
- multi-repo orchestration changes unrelated to this worker adapter;
- changes to Terra authority;
- weakening Independent Review;
- real-host LaunchAgent install/load/register;
- production `/slot` mutation or deploy.

A narrow Worker contract plus existing Codex adapter plus OpenCode adapter plus explicit routing modes is enough.

---

## 14. Acceptance criteria

This delta is complete only when all of the following are true:

1. Existing Luna/Codex execution remains backward compatible and tests pass.
2. A local OpenCode worker adapter exists and is not hard-coded to Qwen3.8 implementation semantics.
3. Qwen3.8-27B via OpenCode/Ollama can be configured as the local worker.
4. Operator can explicitly choose `cloud`, `local`, or `auto` behavior without code changes.
5. Primary and Recovery provider choices can be represented without a semantic router framework.
6. `auto` starts cloud and latches the remainder of the current run to local after a genuine cloud rate/usage/quota limit.
7. Provider fallback is separate from REWORK/STUCK/Recovery budget.
8. Fallback starts local work from durable facts, never hidden cloud reasoning/history.
9. Required local preflight fails closed when OpenCode/Ollama/model/context prerequisites are not satisfied.
10. Intended local context is 131072 and is not silently downgraded.
11. Independent Reviewer and deterministic merge gates apply identically to local implementation work.
12. Durable evidence records provider/routing/fallback facts without secrets/private reasoning.
13. Fake/integration tests cover routing and failure paths.
14. A read-only real local-stack preflight is executed if the current host is accessible; otherwise the environmental limitation is explicitly recorded.
15. A safe real-Qwen pilot is executed if technically accessible before return; otherwise it remains a clearly identified pre-install validation item rather than silently assumed PASS.
16. No real-host LaunchAgent installation or production mutation occurs.
17. Final Terra Acceptance rechecks the whole product after this delta and leaves AO-16 host installation as a separate operator Human Gate only when all required pre-install evidence is satisfied.

---

## 15. Planning Terra instructions

Planning Terra should create a **delta task-board / DAG only**. Do not redo completed AO-01 through AO-26 work.

Planning should begin after AO-26 and use new Task IDs continuing the sequence.

The plan should separate, where sensible:

- actual OpenCode/Ollama contract investigation and worker abstraction;
- OpenCode adapter/lifecycle normalization;
- routing/configuration and rate-limit latch;
- local-stack preflight/context validation;
- integration/pilot evidence;
- Final Terra Acceptance.

Each Task must specify:

- scope / allowed paths;
- non-scope;
- dependencies;
- SAFE / EXCLUSIVE;
- Human Gate;
- completion / acceptance;
- tests/verification;
- assumptions;
- invariants.

Planning Terra must audit:

- no contradiction with the 2026-09-02 authority/review/merge/recovery model;
- no accidental daemon semantic judgment;
- no provider fallback counted as implementation recovery;
- no hidden assumption that OpenCode uses Codex session/event formats;
- no silent context downgrade;
- no unnecessary generalized provider framework;
- no real-host install in implementation Tasks.

Planning Terra should commit/push the new task-board and machine manifest, then stop without implementing code.
