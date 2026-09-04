# Agent Orchestrator pre-install delta operator runbook

## Commands

Run `npm run build` before using the CLI. The operational commands are:

- `bootstrap`: project the canonical manifest into GitHub Issues.
- `run-once`: reconcile facts, schedule ready work, and monitor existing processes once.
- `daemon`: repeat `run-once` at the configured interval.
- `reconcile`: perform startup reconciliation without dispatching new work.
- `status`: print checkpoint/Issue/process status.
- `preflight`: perform the read-only local OpenCode/Ollama/model/context check.

The daemon may auto-merge only after the Independent Reviewer has approved and
all deterministic gates pass: tests, machine validation, scope/unexpected diff,
clean worktree, pushed branch, dependency/base consistency, reviewed-HEAD
equality, no Human Gate, and no global Plan Revision barrier. The daemon never
infers semantic approval and does not invoke an LLM while polling, scheduling,
validation, or merge-gate evaluation runs. It never modifies production data or
schedulers.

## Failure diagnosis

1. Inspect `status` and the privacy-safe JSON log.
2. Check the task Issue state and the local checkpoint outside the repository.
3. For a dirty worktree, scope mismatch, missing session, or exhausted retry,
   leave the task `blocked-human` and resolve the fact manually.
4. A rate limit is a pause: wait for `retryAt`; do not create a new session.
5. A normal `REWORK` resumes the same Primary Worker, up to three cycles.
   Repeated findings/test failures or simple diff oscillation trigger one fresh
   Recovery Worker. Recovery receives durable evidence, not old conversation
   history; if it is exhausted, pure implementation failure is `BLOCKED_HUMAN`.
6. A Worker PLAN_CONFLICT claim is not enough to call Terra. An Independent
   Reviewer must return `PLAN_CONFLICT_CONFIRMED`; only then does the daemon
   enable the global merge barrier and pause the affected downstream set.
   Unrelated SAFE work may continue. Terra is callable for Planning, confirmed
   Plan Revision, and final acceptance only.
7. Sessions are `ACTIVE`, `RESUMABLE`, `RETIRED`, or `CLEANUP`. Never delete a
   RESUMABLE session; reviewer sessions are cleaned after durable evidence and
   task sessions after close or takeover.

Do not run production experiments from the pilot acceptance fixture. Do not
install a LaunchAgent as part of normal daemon startup.

## Worker routing and local preflight

The optional `worker` block controls implementation workers without source
changes. Its `mode` is `cloud`, `local`, or `auto`; `primary` and `recovery`
are independently explicit providers. Omitting the block is cloud-only for
backwards compatibility. `auto` starts with its configured provider and, on
an explicit cloud `RATE_LIMIT`, `USAGE_LIMIT`, or `QUOTA_LIMIT`, records a
provider-fallback fact and latches the rest of that run to a fresh local
session. This does not consume REWORK or Recovery budget. A later run starts
with the configured mode again.

For local or auto operation, set `worker.local` with the OpenCode executable,
model identifier, working directory, Ollama endpoint, and OpenCode config
path. The read-only local preflight checks every path, OpenCode availability,
the exact configured model, Ollama model availability, and context `262144`.
It fails closed when any fact is absent or incompatible and never starts
Ollama, pulls a model, writes configuration, or downgrades context.

## LaunchAgent (operator-only)

AO-16 packaging is in `packaging/launchd`. The template is rendered with
operator-supplied absolute paths and validated with `plutil` before loading.
The repository-owned executable entrypoint is `bin/agent-orchestrator.mjs`.
`AO_LAUNCHD_CLI` must point to its absolute path; it composes the concrete
`CliOperations`. Do not use an external wrapper or point LaunchAgent at
`dist/src/cli/cli.js` directly.
The following commands are explicit host mutations and must be run by an
operator on the intended macOS host; they are never called by the daemon:

```sh
export AO_LAUNCHD_WORKDIR=/absolute/path/to/agent-orchestrator
export AO_LAUNCHD_CLI=/absolute/path/to/agent-orchestrator/bin/agent-orchestrator.mjs
export AO_LAUNCHD_NODE=/absolute/path/to/node
export AO_CONFIG_PATH=/absolute/path/to/agent-orchestrator/docs/runbooks/agent-orchestrator-config.example.yaml
packaging/launchd/preflight.sh
packaging/launchd/manage.sh install
packaging/launchd/manage.sh status
packaging/launchd/manage.sh uninstall
```

Before any mutation, run `packaging/launchd/manage.sh verify`. It only checks
the checked-in plist template and does not call `launchctl`, create files, or
change the host. `install` uses the per-user `gui/<uid>` domain and
`Library/LaunchAgents`; `uninstall` boots out the label and removes only the
generated plist. Use `status` to inspect the loaded label without changing it.
