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

## LaunchAgent (operator-only)

AO-16 packaging is in `packaging/launchd`. The template is rendered with
operator-supplied absolute paths and validated with `plutil` before loading.
The following commands are explicit host mutations and must be run by an
operator on the intended macOS host; they are never called by the daemon:

```sh
export AO_LAUNCHD_WORKDIR=/absolute/path/to/agent-orchestrator
export AO_LAUNCHD_CLI=/absolute/path/to/agent-orchestrator-cli.mjs
export AO_LAUNCHD_NODE=/absolute/path/to/node
packaging/launchd/manage.sh install
packaging/launchd/manage.sh status
packaging/launchd/manage.sh uninstall
```

Before any mutation, run `packaging/launchd/manage.sh verify`. It only checks
the checked-in plist template and does not call `launchctl`, create files, or
change the host. `install` uses the per-user `gui/<uid>` domain and
`Library/LaunchAgents`; `uninstall` boots out the label and removes only the
generated plist. Use `status` to inspect the loaded label without changing it.
