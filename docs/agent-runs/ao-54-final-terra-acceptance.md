# AO-54 Final Terra Acceptance

Date: 2026-09-07 JST
Status: **PASS for the reworked source branch**

Final source branch: `codex/ao-48-54-runtime-executable`
Source HEAD used for the successful fresh E2E: `4f3e63fd35561ce526035e9d31550d15616bf921`

## Checkpoint commits

| Task / checkpoint | Remote SHA |
| --- | --- |
| AO-48 original boundary | `5a35add54c38912c0d9faccacc4d6c15192910f8` |
| AO-49 reviewer transport | `55f88b98985a51def196134dcc46b3280b9b93ca` |
| AO-49 correction | `5c596ccd07bdee77e6297291185cf9fbc43fdcfc` |
| AO-50 worker factory | `ad43f8312be281b151ec2d28e0709bcf1db2eddd` |
| AO-50 correction | `1e4d5ee27e3a40c982160b1ef52b5a75d71fe7c7` |
| AO-51 executable composition | `9c6de6c560febbb2aa8a37278e98ff4ce5d33dae` |
| AO-50 detached worker/fallback rework | `52dbe0ca5cd505ee00d61733a35187359fb33df0` |
| AO-51 nonblocking poll rework | `e41ec7f091d6664188a1006c54b4020d60f5219a` |
| AO-52 fresh E2E task | `f72fa722e4b2f9ec774747a64711c558ec746ec8` |
| AO-49 reviewer stdin rework + E2E V2 task | `2fdeb006e5f64afaac2d7745ac54ef5fd4397321` |
| AO-52 final-source E2E V3 task | `4f3e63fd35561ce526035e9d31550d15616bf921` |

All rows are full SHAs in the pushed ancestry; the final row is the final
source HEAD used by the successful fresh real E2E.

## AO-48〜AO-54 status

AO-48 **PASS**, AO-49 **PASS**, AO-50 **PASS**, AO-51 **PASS**, AO-52
**PASS**, AO-53 **PASS**, AO-54 **PASS**. All statuses are represented in the
pushed board/manifest, and this evidence file is part of the final checkpoint.

## Verification

- `npm test`: **PASS**, 117 tests passed, 0 failed.
- `npm run build`: **PASS**.
- `npm run lint`: **PASS**.
- `git diff --check`: **PASS**.
- `packaging/launchd/manage.sh verify`: **PASS**; read-only verification.
- Controlled parallel-worker test: **PASS**. Two SAFE tasks at
  `maxLunaWorkers=2` held distinct PID/worktree/branch ownership concurrently;
  EXCLUSIVE serialization and `maxLunaWorkers=1` sequential behavior are
  covered by scheduler/runtime tests.
- Auto-fallback restart test: **PASS**. Cloud availability limit latched local
  in the checkpoint; a fresh Router/RuntimeComposition resumed the same local
  provider/session, did not retry Cloud, and preserved the shared lease facts.
- Restart/recovery verification: **PASS** for running, worker-done/pre-review,
  approved/pre-merge, and changed-reviewed-HEAD fail-closed cases.

## Fresh real AO-52 E2E

The successful E2E was run from source HEAD
`4f3e63fd35561ce526035e9d31550d15616bf921`, after the detached worker,
checkpoint-authoritative fallback, and current reviewer stdin/timeout fixes.
It used disposable repository `AZ-claude/agent-orchestrator-disposable-20260906`,
Issue `#6`, Task `AO-52-FINAL-E2E-20260907-V3`, and real Worker provider
Cloud/Luna (`codex`, session
`01a07927-b872-7c01-b7fe-5893a25c90d9`).

The sequence passed: READY projection → concrete executable dispatch → real
Worker branch/worktree/commit/push → validation → current
`CodexReadOnlyReviewer` APPROVE → reviewed HEAD persistence → deterministic
merge and main push → Issue close → worktree cleanup. Worker commit,
reviewed HEAD, task branch, and target `main` are all
`e75be45c0fe643a457975418b42ea2bbca079af6`. The durable checkpoint records
`processOutcome: success`, `review: APPROVE`, `reviewedHead` equal to that
merged HEAD, and lifecycle `CLEANUP`. A second `run-once` returned
`completed`/skip and dispatched no Worker.

The earlier #1 and failed pre-fix #4 attempts are explicitly excluded from
this PASS; #4 was closed as a blocked reviewer rehearsal and its remote branch
was retained as audit history.

## Worker/reviewer contracts

- Concrete Worker factory: `LunaRunner`, `CloudWorkerAdapter`,
  `OpenCodeWorkerAdapter`, `WorkerRunRouter`, `WorkerDispatcher`, and
  `DurableWorkerRuntime` are built from config.
- Real Worker: Cloud `codex/luna` for the E2E.
- Concrete Reviewer transport: `CodexReadOnlyReviewer`, a fresh
  `codex exec --sandbox read-only` process with stdin disabled, 120-second
  timeout, and only ReviewPacket/scope/source-HEAD evidence.
- Local contract: `ollama/qwen3.8:latest`, context `262144`, read-only
  preflight, and shared lease. The local model was not invoked by the real
  Cloud E2E; contract and lease tests passed.
- Reviewed HEAD: `e75be45c0fe643a457975418b42ea2bbca079af6`.
- Merged HEAD: `e75be45c0fe643a457975418b42ea2bbca079af6`.

## Boundaries and final gate

No `/slot` or `/kiji` runtime, DB, scheduler, or production resource was
operated. No `manage.sh install`, `launchctl bootstrap`, `launchctl load`, or
plist registration was executed.

Unresolved issue: none for AO-48〜AO-54. The historical #4 reviewer timeout is
resolved by the stdin-closed transport and is not part of the final E2E.

LaunchAgent: **NO-GO** pending the separate explicit Human Gate.
