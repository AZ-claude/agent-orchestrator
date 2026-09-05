# AO-42 Final Terra Acceptance — fixed local-Qwen allocation

Status: **PASS** (2026-09-06 JST)

AO-41 [real-host pilot evidence](./ao-41-pilot.md) is accepted. The following
whole-product criteria agree:

| Criterion | Result |
|---|---|
| Fixed allocation | PASS — Kiji uses `qwen3.6:35b`; AO uses `ollama/qwen3.8:latest` |
| Exact context | PASS — both pilot requests and final idle state are `262144` |
| Read-only preflight | PASS — AO and Kiji model/config/service facts validated before pilot |
| Shared lease | PASS — one capacity-one lease, acquire-before-request, release-after-terminal state |
| No overlap | PASS — Kiji → AO → Kiji restoration was serialized; lease absent between calls |
| 32K prevention | PASS — Kiji provider rejects non-262144; no downgrade was used |
| Cross-client fake proof | PASS — AO-40 evidence and current full suites agree |
| Restoration | PASS — final sole idle model is `qwen3.6:35b` at `262144` |
| Cloud/backward compatibility | PASS — existing AO tests and final acceptance tests pass |
| Reviewer/merge/Terra authority | PASS — AO-36–AO-40 independent review evidence remains PASS; no code fix or merge was performed here |
| Production separation | PASS — no Kiji production DB, Scheduler, `/slot` production processing, model pull, or permanent configuration mutation |
| LaunchAgent separation | PASS — `packaging/launchd/manage.sh verify` only; AO LaunchAgent is not loaded and install/load/register remains unexecuted |

## Verification

- AO `npm test`: **99 passed**
- AO `npm run build`: **PASS**
- AO `npm run lint`: **PASS**
- AO `packaging/launchd/manage.sh verify`: **PASS**
- Kiji `.venv/bin/pytest -q`: **147 passed**
- Final read-only Ollama state: `qwen3.6:35b` only, context `262144`
- Final shared lease: absent
- AO LaunchAgent read-only status: not loaded

Terra decision: **PASS**. AO-41 and AO-42 are complete. The separate
real-host Agent Orchestrator LaunchAgent install/load/register Human Gate
remains unexecuted.
