# AO-41 real-host handoff pilot

Status: **PASS** (2026-09-06 JST)

## Boundary and target

- Operator-approved disposable target: `/tmp/ao41-pilot-target`.
- Shared lease: `/Users/eita/.local/state/ollama-inference/lease`.
- Kiji was invoked as a provider-only smoke test with a synthetic marker; no
  Kiji DB, session history, article store, Scheduler, or publish path was
  used.
- AO ran OpenCode with the disposable target as its working directory. The
  `/slot` production target was not dispatched, read, or modified.
- No model pull, permanent Ollama configuration change, or LaunchAgent
  install/load/register was performed.

## Preflight

| Check | Result |
|---|---|
| AO read-only local preflight | PASS — OpenCode 1.18.23, `ollama/qwen3.8:latest`, exact configured context 262144, model capability 262144, service context 262144 |
| Kiji read-only preflight | PASS under the pilot process environment `KIJI_OLLAMA_NUM_CTX=262144` — `qwen3.6:35b` listed, model context 262144, lease probe path disposable |
| Ollama service constraints | PASS — `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, `OLLAMA_CONTEXT_LENGTH=262144`, `OLLAMA_KEEP_ALIVE=-1` |
| Pre-pilot loaded model | PASS — `qwen3.6:35b` alone at context 262144 |

The inherited shell had `KIJI_OLLAMA_NUM_CTX=131072`; it was not changed
persistently. The pilot explicitly supplied the required 262144 value and the
provider rejects any non-262144 value, so no downgrade was silently accepted.

## Ordered handoff evidence

1. Kiji `qwen3.6:35b`: synthetic marker observed, context `262144`, lease
   terminal evidence `owner=kiji`, `model=qwen3.6:35b`, `status=released`.
2. Agent Orchestrator `ollama/qwen3.8:latest`: OpenCode outcome `success`, exit
   code `0`, context `262144`, lease terminal evidence
   `owner=agent-orchestrator`, `model=ollama/qwen3.8:latest`,
   `status=released`.
3. Kiji `qwen3.6:35b`: bounded restoration request completed through the same
   lease so the nominated idle model could be restored.

After each invocation the shared lease directory was absent before the next
invocation began. This proves the ordered calls did not overlap and that
acquisition preceded inference and release followed terminal cleanup.

## Restoration

Final read-only `ollama ps`:

```text
qwen3.6:35b  ...  100% GPU  262144  Forever
```

The final shared lease was absent. The nominated sole idle model is therefore
`qwen3.6:35b` at context `262144`.
