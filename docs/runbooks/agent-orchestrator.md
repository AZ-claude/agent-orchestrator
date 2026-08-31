# Agent Orchestrator v1 operator runbook

## Commands

Run `npm run build` before using the CLI. The operational commands are:

- `bootstrap`: project the canonical manifest into GitHub Issues.
- `run-once`: reconcile facts, schedule ready work, and monitor existing processes once.
- `daemon`: repeat `run-once` at the configured interval.
- `reconcile`: perform startup reconciliation without dispatching new work.
- `status`: print checkpoint/Issue/process status.

The daemon does not merge branches, modify production databases or schedulers,
or invoke an LLM while polling, scheduling, validation, or recovery runs.

## Failure diagnosis

1. Inspect `status` and the privacy-safe JSON log.
2. Check the task Issue state and the local checkpoint outside the repository.
3. For a dirty worktree, scope mismatch, missing session, or exhausted retry,
   leave the task `blocked-human` and resolve the fact manually.
4. A rate limit is a pause: wait for `retryAt`; do not create a new session.
5. A Terra `APPROVE` is not close authority until the remote base contains the
   task HEAD. Terra performs the merge; the daemon only verifies and closes.

Do not run production experiments from the pilot acceptance fixture. Do not
install a LaunchAgent as part of normal daemon startup.
