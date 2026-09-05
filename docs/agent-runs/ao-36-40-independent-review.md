# AO-36–AO-40 implementation and independent review

Status: **PASS** (2026-09-05 JST)

Task board: [fixed local-Qwen allocation board](../task-boards/2026-09-04-fixed-local-qwen-allocation.md)

## Acceptance result

| Task | Result | Evidence |
|---|---|---|
| AO-36 | PASS | Version-1 two-owner contract, exact model/context mapping, absolute shared lease path, non-secret evidence, and contract fixture. |
| AO-37 | PASS | AO accepts only `ollama/qwen3.8:latest`; read-only preflight rejects missing/mismatched model, config, capability, or persistent service context. |
| AO-38 | PASS | AO acquires before OpenCode spawn, holds through terminal cleanup, records busy/timeout/malformed/stale facts, and reconciles only a dead AO owner. |
| AO-39 | PASS | `/kiji` date/time Qwen uses only `qwen3.6:35b` with `num_ctx=262144`, shares the lease, rejects the former 32K fallback, and releases on terminal paths. |
| AO-40 | PASS | Cross-client fake proves fixed ownership, exact context, one shared holder, no request before acquire, and safe contention/release behavior. |

## Verification

- AO `npm test`: **97 passed**
- AO `npm run lint`: **PASS**
- AO `packaging/launchd/manage.sh verify`: **PASS**
- AO `git diff --check`: **PASS**
- `/Users/eita/projects/kiji/.venv/bin/pytest -q`: **147 passed**
- `/kiji` `git diff --check`: **PASS**
- AO real read-only preflight: **PASS** — OpenCode 1.18.23, configured/listed
  `qwen3.8:latest`, model capability 262144, and persistent service context
  262144.

The independent reviewer was the required same-session read-only Luna
subagent. Its final result was **PASS** after it re-reviewed both repositories,
including the lease mutation gate: `claim.json` is created inside the live
lease directory, owner/PID/nonce are validated, dead same-owner claims alone
are recoverable, and the live record is re-read before rename.

No real Ollama inference, production `/kiji` data operation, Scheduler change,
model management, or LaunchAgent install/load/register was performed.

## Boundary

AO-41 and AO-42 remain pending. AO-41 requires the operator Human Gate to name
the disposable non-production `/kiji` target and the model that must be the
sole idle model after the pilot. Until those two values are supplied, no real
handoff pilot is safe to run and AO-42 cannot be recorded as Terra PASS.
