# AO-43+ runtime composition and disposable E2E

Status: **PASS for AO-43〜AO-53; AO-54 PLANNED.** AO-48 was revised from a confirmed task-decomposition PLAN_CONFLICT, not an implementation failure or Human Gate. This phase is deliberately separate from AO-41/AO-42:
those tasks accepted fixed local-Qwen allocation only, not daemon operation.
No task in this board may install, bootstrap, load, or register a LaunchAgent,
or operate `/slot` or `/kiji` production resources.

## Goal

Connect the existing scheduler, durable worker runtime, validation, independent
review, deterministic merge, GitHub projection and reconciliation components so
one poll can safely advance one disposable task through completion. Runtime
state is checkpoint-authoritative; memory is only a cache.

## Tasks

### AO-43 — Safe runtime configuration boundary

- State: DONE; dependencies: none; parallel: EXCLUSIVE.
- Add an explicit disposable-target configuration and a separately gated future
  production configuration. Reject targets outside an allowlist and reject
  `/slot` and `/kiji` for disposable execution.

### AO-44 — Durable poll composition and reconciliation

- State: DONE; dependencies: AO-43; parallel: EXCLUSIVE.
- Wire scheduler dispatch, checkpoint persistence, process/session/git/Issue
  observation, and restart-safe continuation. Duplicate task, branch, or
  worktree ownership fails closed.

### AO-45 — Worker/reviewer/merge lifecycle wiring

- State: DONE; dependencies: AO-44; parallel: EXCLUSIVE.
- Reach the existing validation, Independent Reviewer, REWORK/Recovery and
  deterministic merge gates from the runtime; close/unlock/cleanup only after
  a matching reviewed HEAD merges. Supporting worker resume/retirement and
  Git worktree cleanup adapters are part of this wiring scope.

### AO-46 — Disposable real E2E and restart evidence

- State: DONE; dependencies: AO-45; parallel: EXCLUSIVE.
- Exercise one isolated git fixture end-to-end and prove restart continuation
  at running, worker-done and reviewed-before-merge checkpoints without a
  duplicate dispatch.

### AO-47 — Independent review and Terra final acceptance

- State: DONE; dependencies: AO-46; parallel: EXCLUSIVE.
- Review the completed phase and record PASS only with the disposable E2E and
  restart evidence. LaunchAgent installation remains a separate Human Gate.

## Executable runtime and external-boundary follow-up

AO-43〜AO-47 provide the reusable `RuntimeComposition` wiring, but they do
not yet prove that the production executable constructs it itself or that the
real GitHub boundary selects the runtime target. The following work is
serialized where it crosses the executable and external boundaries. It must
reuse the existing components; it is not authorization to rebuild the runtime
or to operate `/slot`, `/kiji`, or a LaunchAgent.

```text
AO-47 accepted composition
  ├─> AO-48 target-aware GitHub boundary
  ├─> AO-49 concrete Independent Reviewer transport
  └─> AO-50 concrete Worker runtime factory
        AO-48 + AO-49 + AO-50
                         └─> AO-51 concrete executable composition + Human Gate wiring
                                   └─> AO-52 disposable GitHub real E2E
                                   └─> AO-53 restart / recovery verification
                                             └─> AO-54 Final executable acceptance
                                                       └─> LaunchAgent Human Gate (separate, not planned)
```

### AO-48 — Target-aware GitHub repository boundary

- State: DONE; dependencies: AO-47; parallel: EXCLUSIVE; Human Gate: none.
- Resolve GitHub owner/name explicitly from runtime target and verify the local
  target's `origin` matches before any Issue operation/dispatch. `/slot` and
  `/kiji` are rejected for disposable runtime; `AZ-claude/slot` remains only
  an explicit isolated legacy-pilot path.

### AO-49 — Concrete Independent Reviewer transport

- State: DONE; dependencies: AO-47; parallel: EXCLUSIVE; Human Gate: none.
- Implement a concrete, capability-checked read-only transport. It receives no
  implementation reasoning/history and only a ReviewPacket plus minimal scope
  and source-HEAD facts; it cannot edit code and returns structured existing
  controller-compatible results. Capability absence fails closed.

### AO-50 — Concrete Worker runtime factory

- State: DONE; dependencies: AO-47; parallel: EXCLUSIVE; Human Gate: none.
- Assemble the existing LunaRunner, cloud/local adapters, router, dispatcher,
  and durable worker runtime from config. Preserve cloud/local/auto behavior;
  local is `ollama/qwen3.8:latest` at 262144 with preflight and shared lease.

### AO-51 — Concrete executable runtime composition

- State: DONE; dependencies: AO-48, AO-49, AO-50; parallel: EXCLUSIVE;
  Human Gate: none.
- Only after its prerequisites, construct every runtime dependency from config
  in `bin/agent-orchestrator.mjs` without `runtimeFactory`. Wire
  `maxLunaWorkers` plus durable, explicit Human Gate evidence through dispatch
  and merge; never use an empty approval set or unconditional false gate.

### AO-52 — Disposable GitHub real E2E

- State: DONE; dependencies: AO-51; parallel: EXCLUSIVE;
  Human Gate: none.
- Create/use one dedicated disposable GitHub repository—never `/slot` or
  `/kiji`—and one minimal Issue. From the real CLI prove:

  `Issue READY → dispatch → branch/worktree → Worker commit/push → validation
  → independent review → reviewed HEAD persistence → deterministic merge/main
  push → Issue close → cleanup`.

- Run `run-once` again and prove the completed task is not re-executed. Record
  the disposable repository, Issue number, provider/model, reviewer result,
  reviewed/merged HEADs, merge/close result, and local context/lease evidence
  if local is used.

### AO-53 — Restart / recovery real-boundary verification

- State: DONE; dependencies: AO-52; parallel: EXCLUSIVE; Human Gate: none.
- Starting from the disposable boundary proof, verify checkpoint-authoritative
  restarts at running, worker-done/pre-review, and approved/pre-merge. No case
  may cause duplicate Worker dispatch, merge, or Issue close; a changed
  reviewed HEAD must fail closed. Controlled fixtures/injection may cover
  variation after one real external-boundary E2E.

### AO-54 — Final executable acceptance

- State: PLANNED; dependencies: AO-52, AO-53; parallel: EXCLUSIVE; Human
  Gate: none.
- Run `npm test`, `npm run build`, `npm run lint`,
  `packaging/launchd/manage.sh verify`, a concrete entrypoint disposable
  `run-once`, the disposable real E2E, and restart verification. Terra may
  PASS only when every AO-48〜AO-53 acceptance condition passes, no production
  resource has been touched, and LaunchAgent remains uninstalled/unloaded.
- On PASS, stop and report the exact HEAD/config/target setup with the request
  for the separate Human Gate: “このHEAD、このconfig、このtarget設定で
  LaunchAgentをinstallしてよい”. `manage.sh install`, `launchctl bootstrap`,
  `launchctl load`, and plist registration remain forbidden until then.
