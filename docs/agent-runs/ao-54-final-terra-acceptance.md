# AO-54 Final Terra Acceptance

Date: 2026-09-07 JST
Status: **PASS for the corrected V5 source and disposable E2E**

Final source branch: `codex/ao-48-54-runtime-executable`
Source HEAD used for the successful V5 E2E: `e341f33676569c7cb530db999c1b076f22b8ed78`

## V4 discrepancy and correction

The prior V4 rehearsal is excluded from acceptance. Its temporary local
manifest/config selected `e2e-base`, while the Git-tracked manifest remained
V3. The normal controller reached reviewer `APPROVE`, and the old merge gate
treated a successful push to that configured base as sufficient, so Issue #7
closed while disposable `main` remained at `e75be45c0fe643a457975418b42ea2bbca079af6`.

The corrected merge gate now verifies, before the controller can close an
Issue, that the source remote branch equals the reviewed HEAD and that the
actual remote base branch contains the reviewed HEAD after push. The V5
manifest was committed and pushed before the E2E began.

## V5 fresh real E2E

Disposable repository: `AZ-claude/agent-orchestrator-disposable-20260906`
Issue: `#8`
Task: `AO-52-FINAL-E2E-20260907-V5`
Worker provider: Cloud Luna/Codex

The complete sequence passed:

`READY → real executable → Worker → commit/push → validation → current
Reviewer APPROVE → reviewed HEAD persistence → source remote HEAD verification
→ deterministic merge → remote main verification → Issue close → cleanup`

Verified remote facts:

- Worker branch HEAD: `ae9a92526e1ae2d2f7eb87d46a811c6127eec2a2`
- Reviewed HEAD: `ae9a92526e1ae2d2f7eb87d46a811c6127eec2a2`
- Remote `main` HEAD: `ae9a92526e1ae2d2f7eb87d46a811c6127eec2a2`
- `git merge-base --is-ancestor reviewed HEAD origin/main`: PASS
- Issue #8: CLOSED
- target worktree list: main checkout only
- second `run-once`: completed/skip path, no Worker redispatch

The durable checkpoint records `processOutcome: success`, `review: APPROVE`,
`reviewedHead` equal to the remote main HEAD, and lifecycle `CLEANUP`.

## Restart durability and controlled tests

- A: detached Worker completion was reconstructed from worktree HEAD, base
  ancestry, and remote branch HEAD after callback loss; no duplicate dispatch;
  validation → review → merge passed.
- B: Cloud→Local fallback persisted Local provider, PID, fallback fact, lease
  evidence, and session; regenerated runtime watched Local without Cloud
  redispatch.
- C: Local completion after daemon restart was reconstructed from Git and
  reached validation → review → merge.
- Close-before-remote-main test: a push command that did not update remote
  base fails the merge gate and cannot close the Issue.

## Verification

- `npm test`: **PASS**, 120 tests passed, 0 failed.
- `npm run build`: **PASS**.
- `npm run lint`: **PASS**.
- `git diff --check`: **PASS**.
- `packaging/launchd/manage.sh verify`: **PASS**; read-only verification.

## Boundaries

No `/slot` or `/kiji` runtime, DB, scheduler, or production resource was
operated. No `manage.sh install`, `launchctl bootstrap`, `launchctl load`, or
plist registration was executed. No source repository `main` merge was done;
the disposable V5 E2E intentionally merged only the task branch into its
disposable `main`.

LaunchAgent: **NO-GO** pending the separate explicit Human Gate.
