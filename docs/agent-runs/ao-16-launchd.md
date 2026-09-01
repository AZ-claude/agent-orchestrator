# AO-16 LaunchAgent packaging evidence

Status: **IMPLEMENTATION VERIFIED — HUMAN GATE PENDING** (2026-09-01 JST).

AO-16's repository-side scope is complete: the LaunchAgent template, renderer,
operator lifecycle script, runbook, and disposable verification are present.
No real-host LaunchAgent was installed, loaded, or removed during this work.

## Evidence

- `packaging/launchd/com.az-claude.agent-orchestrator.plist.template`
- `packaging/launchd/render.mjs`
- `packaging/launchd/manage.sh`
- `test/launchd/launchd.test.ts`
- `docs/runbooks/agent-orchestrator.md`
- `npm test`: 56/56 passing, including 2 LaunchAgent tests
- `npm run build`: PASS
- `npm run lint`: PASS
- `packaging/launchd/manage.sh verify`: template-only, non-mutating check

The verification uses a fake `launchctl` and temporary HOME, and proves the
render/install/status/uninstall lifecycle without touching the host.

## Readiness conditions for human decision

Before considering `install`, the operator must confirm all of the following:

1. The intended host is the macOS controller host, not `/slot` production.
2. `AO_LAUNCHD_WORKDIR` is an absolute existing directory.
3. `AO_LAUNCHD_NODE` is the intended executable Node.js binary.
4. `AO_LAUNCHD_CLI` points to a real executable wrapper. This repository's
   `src/cli/cli.ts` is a library dispatcher and does not provide that wrapper
   by itself.
5. The operator has reviewed the generated paths and explicitly approved the
   LaunchAgent registration.

The safe sequence is `verify`, then (only after explicit approval) `install`,
then `status`. `uninstall` is the rollback operation. These commands do not
modify production databases, Windows Scheduler, GitHub Projects, or deploys.

## Completion boundary

AO-16 is not marked fully closed by real-host evidence: host registration is a
Human Gate, and the AO-15 historical independent-review record predates AO-16.
The current board status therefore distinguishes package implementation
verification from host application.
