# AO-35 Final Terra Acceptance — Qwen/OpenCode worker delta

Status: **PASS** (2026-09-04 JST)

Canonical requirements: [2026-09-03 Qwen/OpenCode HANDOFF](../HANDOFF_2026-09-03_QWEN_OPENCODE_WORKER_DELTA.md).
Task board: [AO-27–AO-35 board](../task-boards/2026-09-03-qwen-opencode-worker-preinstall-delta.md).
Independent review records: AO-27, AO-28, AO-29, AO-30, AO-31, AO-32, [AO-33 deterministic acceptance](./ao-33-deterministic-acceptance.md), and AO-34.

## Whole-product acceptance

| Requirement | Evidence | Result |
|---:|---|---|
| 1. Cloud Luna/Codex compatibility | `src/worker/cloud.ts`, existing Luna/Codex tests | PASS |
| 2. OpenCode local adapter | `src/opencode/lifecycle.ts`, `src/opencode/runner.ts`, AO-29 review | PASS |
| 3. Configured local Qwen model path | AO-34 real `ollama/qwen3.8:latest` (27.3B) pilot | PASS |
| 4–5. Explicit modes and role/provider choices | `src/config/schema.ts`, `src/worker/routing.ts` | PASS |
| 6–8. Auto fallback, latch, and durable-facts-only fresh local route | `src/worker/routing.ts`, `src/worker/runtime.ts`, pilot assertions | PASS |
| 9–10. Fail-closed local preflight and exact 262144 context | `src/opencode/preflight.ts`, AO-31 review, AO-34 real result | PASS |
| 11. Independent Reviewer and deterministic merge unchanged | `src/controller/controller.ts`, controller tests | PASS |
| 12. Provider-neutral durable evidence without secrets/history | `src/worker/evidence.ts`, checkpoint tests | PASS |
| 13. Fake/integration failure and routing coverage | AO-33 fixture and `test/{worker,opencode,pilot}.test.ts` | PASS |
| 14–15. Real preflight/pilot evidence | AO-34 | PASS |
| 16. No LaunchAgent or production mutation | AO-27/AO-33/AO-34 records, `manage.sh verify` only | PASS |
| 17. Final Terra recheck and AO-16 separation | this record | PASS |

The 2026-09-04 user requirement superseded the prior fixed-131072 setting:
both models are now configured and operated at 262144. AO-34 passed the real
Qwen3.8-27B OpenCode/Ollama preflight and bounded disposable pilot, then
restored the actual loaded model to qwen3.6:35b at the same 262144 context.
The Ollama LaunchAgent environment and both OpenCode model definitions persist
that setting, so the historical 32K default cannot be selected on restart.

## Final verification

Passed at the final acceptance review:

```sh
npm test -- final-acceptance
npm test
npm run build
npm run lint
packaging/launchd/manage.sh verify
git diff --check
```

No `REWORK`, `PLAN_CONFLICT`, or `REQUIREMENT_CONFLICT` remains for AO-27–AO-35.
Real-host LaunchAgent install/load/register remains unexecuted and is still a
separate AO-16 operator Human Gate.
