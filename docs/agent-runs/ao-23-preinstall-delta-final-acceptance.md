# AO-23 Final Terra Acceptance — pre-install delta

Status: **PASS** (2026-09-02 JST)

Canonical requirement: [2026-09-02 pre-install delta HANDOFF](../HANDOFF_2026-09-02_AGENT_ORCHESTRATOR_PREINSTALL_DELTA.md).  
Implementation reviewed: `6126b6b173584f3c2c2cad73936a4c495ed64b5a`; independent-review record: [AO-22 pilot evidence](./ao-22-preinstall-delta-pilot.md).  
Final verified HEAD: `251cf5be92cbcab5698e1dc7c51a034f8173d792`.

## Result

The completed product satisfies the delta acceptance within its pilot-only,
non-production boundary. No `REWORK`, `PLAN_CONFLICT`, or
`REQUIREMENT_CONFLICT` remains. AO-01–AO-16 history is retained; AO-16's
real-host LaunchAgent registration remains deliberately unperformed.

| Delta acceptance | Evidence |
|---:|---|
| 1–4: Independent review, deterministic merge, changed-HEAD refusal | `src/controller/controller.ts`, `src/git/adapter.ts`, `test/controller.test.ts`, `test/git.test.ts` |
| 5–8: bounded REWORK, early STUCK, fresh Recovery, exhaustion classification | `src/luna/runner.ts`, `src/controller/controller.ts`, `test/controller.test.ts`, `test/pilot.test.ts` |
| 9–11: confirmed PLAN_CONFLICT and REQUIREMENT_CONFLICT authority | `src/controller/authority.ts`, `src/scheduler/scheduler.ts`, `test/controller.test.ts`, `test/scheduler.test.ts` |
| 12–15: merge barrier, revision synchronization, cleanup, resumable retention | `src/reconcile/reconcile.ts`, `src/scheduler/scheduler.ts`, `test/reconcile.test.ts`, `test/pilot.test.ts` |
| 16: assumptions/invariants manifest support | `src/config/schema.ts`, `test/config.test.ts`, `tasks/agent-orchestrator-preinstall-delta.yaml` |
| 17: final acceptance creates work rather than code fixes | this record and the AO-23 task boundary in the delta board |
| 18: quality gates | 66 passing tests, `npm run build`, `npm run lint` |
| 19–20: LLM-free daemon path and retained v1/pilot safety | `src/cli/cli.ts`, `docs/runbooks/agent-orchestrator.md`, `scripts/pilot/fixture.ts`, `test/pilot.test.ts` |

## Final verification

The following commands passed at the final verified HEAD:

```sh
npm test
npm run build
npm run lint
packaging/launchd/manage.sh verify
git diff --check
```

`manage.sh verify` validates only the checked-in template. It does not invoke
`launchctl`, create a LaunchAgent plist, or alter the host.

## Remaining human action

The repository is ready for the existing operator-only AO-16 procedure in the
[operator runbook](../runbooks/agent-orchestrator.md#launchagent-operator-only).
Before the intentionally state-changing install command, the operator must
provide valid absolute paths for the repository workdir, a concrete CLI
entrypoint wrapper that wires `CliOperations`, and Node. Installation itself
is not part of this acceptance and was not performed.
