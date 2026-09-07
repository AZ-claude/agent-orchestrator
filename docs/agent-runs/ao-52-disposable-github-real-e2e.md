# AO-52 Disposable GitHub real E2E

Status: **PASS (re-run from final source HEAD)**

Source HEAD used for this run: `2fdeb006e5f64afaac2d7745ac54ef5fd4397321`

Disposable target: `AZ-claude/agent-orchestrator-disposable-20260906`
Local target: `/tmp/agent-orchestrator-disposable-target`
Issue: `#5`
Task: `AO-52-FINAL-E2E-20260907-V2`

Evidence from the real CLI:

- Issue `READY` label was projected by `bootstrap`.
- `run-once` verified the local `origin` and GitHub `nameWithOwner`, created
  branch/worktree `agent/AO-52-FINAL-E2E-20260907-V2`, and dispatched the real
  Cloud Luna/Codex Worker. The checkpoint recorded its PID before completion.
- Worker created `e2e-final-20260907-v2.txt`, commit
  `e57ae70732491f133efb74f36ccad99732bbbcdd` was pushed, machine validation
  passed, and the current read-only independent Codex review returned
  `APPROVE`.
- The same reviewed HEAD was merged and pushed to `main`; Issue #5 was closed
  and the worktree was cleaned.
- A second `run-once` returned the completed/skip path and did not dispatch a
  second Worker.

Remote verification on 2026-09-07 confirms:

- `origin/main` and `origin/agent/AO-52-FINAL-E2E-20260907-V2` both resolve to
  `e57ae70732491f133efb74f36ccad99732bbbcdd`.
- Issue `#5` is `CLOSED`; the target clone is clean on `main`, and its
  worktree list contains only the main checkout.
- Durable checkpoint `/tmp/agent-orchestrator-runtime-state-ao52-final/AO-52-FINAL-E2E-20260907-V2.json`
  records `workerProvider: cloud`, `workerAdapter: codex/luna`,
  `processOutcome: success`, `review: APPROVE`, `reviewedHead` equal to the
  merged HEAD, and lifecycle `CLEANUP`. This checkpoint was produced from the
  source HEAD above, which contains the current reviewer transport and
  detached Worker changes.

The earlier #1 run and #4 reviewer-transport rehearsal are historical
disposable evidence only and are excluded from this final re-run. #4 was
closed as blocked after the pre-fix reviewer timeout; its remote branch was
retained for audit history.

No `/slot`, `/kiji`, or LaunchAgent resource was operated.
