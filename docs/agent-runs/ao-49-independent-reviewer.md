# AO-49 Independent Reviewer transport

Date: 2026-09-06 JST
Status: **PASS**

The production controller now has a concrete `CodexReadOnlyReviewer`. Each
review starts a fresh `codex exec` process in the assigned worktree with
`--sandbox read-only`; no implementation session ID, prompt history, or rework
conversation crosses the boundary. The prompt contains only the
canonical task scope, committed source HEAD, worktree, and machine evidence.

The transport accepts only structured `APPROVE`, `REWORK`, or plan-conflict
results compatible with the existing controller. Missing executable,
non-zero execution, malformed output, and malformed claims return
`CAPABILITY_UNAVAILABLE`, and the process has a bounded timeout, so the
controller cannot close an Issue on reviewer capability failure or a hung
reviewer process.

Verification: `npm test -- codex-reviewer controller`, `npm run build`, and
`npm run lint` pass.
