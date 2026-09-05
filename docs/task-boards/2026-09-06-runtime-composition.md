# AO-43+ runtime composition and disposable E2E

Status: **IN PROGRESS**. This phase is deliberately separate from AO-41/AO-42:
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

- State: IN PROGRESS; dependencies: none; parallel: EXCLUSIVE.
- Add an explicit disposable-target configuration and a separately gated future
  production configuration. Reject targets outside an allowlist and reject
  `/slot` and `/kiji` for disposable execution.

### AO-44 — Durable poll composition and reconciliation

- State: PLANNED; dependencies: AO-43; parallel: EXCLUSIVE.
- Wire scheduler dispatch, checkpoint persistence, process/session/git/Issue
  observation, and restart-safe continuation. Duplicate task, branch, or
  worktree ownership fails closed.

### AO-45 — Worker/reviewer/merge lifecycle wiring

- State: PLANNED; dependencies: AO-44; parallel: EXCLUSIVE.
- Reach the existing validation, Independent Reviewer, REWORK/Recovery and
  deterministic merge gates from the runtime; close/unlock/cleanup only after
  a matching reviewed HEAD merges.

### AO-46 — Disposable real E2E and restart evidence

- State: PLANNED; dependencies: AO-45; parallel: EXCLUSIVE.
- Exercise one isolated git fixture end-to-end and prove restart continuation
  at running, worker-done and reviewed-before-merge checkpoints without a
  duplicate dispatch.

### AO-47 — Independent review and Terra final acceptance

- State: PLANNED; dependencies: AO-46; parallel: EXCLUSIVE.
- Review the completed phase and record PASS only with the disposable E2E and
  restart evidence. LaunchAgent installation remains a separate Human Gate.
