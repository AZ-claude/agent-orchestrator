# AO-52 Disposable GitHub real E2E

Status: **PASS**

Disposable target: `AZ-claude/agent-orchestrator-disposable-20260906`
Local target: `/tmp/agent-orchestrator-disposable-target`
Issue: `#1`

Evidence from the real CLI:

- Issue `READY` label was projected by `bootstrap`.
- `run-once` verified the local `origin` and GitHub `nameWithOwner`, created
  branch/worktree `agent/AO-52-E2E`, and dispatched Cloud Luna/Codex.
- Worker created `e2e.txt`, commit `c9e273e99689f1d636baf7b8b67bfd658ec52dfd`
  was pushed, machine validation passed, and the read-only independent Codex
  review returned `APPROVE`.
- The same reviewed HEAD was merged and pushed to `main`; Issue #1 was closed
  and the worktree was cleaned.
- A second `run-once` returned the completed/skip path and did not dispatch a
  second Worker.

Remote verification on 2026-09-07 confirms:

- `origin/main` and `origin/agent/AO-52-E2E` both resolve to
  `c9e273e99689f1d636baf7b8b67bfd658ec52dfd`.
- Issue `#1` is `CLOSED`; the target clone is clean on `main`, and its
  worktree list contains only the main checkout.
- Durable checkpoint `/private/tmp/agent-orchestrator-runtime-state-ao52/AO-52-E2E.json`
  records `workerProvider: cloud`, `workerAdapter: codex/luna`,
  `processOutcome: success`, `review: APPROVE`, `reviewedHead` equal to the
  merged HEAD, and lifecycle `CLEANUP`.

An auxiliary reviewer rehearsal (Issue `#3`, branch
`agent/AO-52-E2E-2`) timed out and correctly failed closed; it was excluded
from this acceptance and closed during disposable cleanup. Its remote branch
remains only as audit history.

No `/slot`, `/kiji`, or LaunchAgent resource was operated.
