# Agent Orchestrator production boundary

The v1 production target is only `AZ-claude/slot` on `master`, through the
orchestrator-owned clone at `/Users/eita/.local/share/agent-orchestrator/targets/slot`.
The normal development checkout `/Users/eita/projects/slot` is never a runtime
target and is never inspected, fetched, checked out, reset, or used for worktrees.

Production execution requires both an exact target declaration and explicit
`production.enabled: true`. The checked-in example and the host config remain
`false` until the LaunchAgent Human Gate. Before dispatch, the runtime requires
the clone's exact origin, attached clean `master`, matching `origin/master` and
remote `master`, and only state-root-owned `agent/*` worktrees.

This manifest intentionally projects no tasks before the Human Gate.
