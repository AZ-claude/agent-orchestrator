# AO-34 Local-stack preflight and Qwen pilot

Result: **PASS** (2026-09-04 JST)

Independent review: **APPROVE** (read-only review of the real preflight,
bounded pilot result, and restoration evidence)

The real, read-only preflight was executed against the configured local stack:

| Fact | Result |
|---|---|
| OpenCode executable | PASS — `/Users/eita/.opencode/bin/opencode` |
| OpenCode version | PASS — `1.18.23` |
| OpenCode config/context | PASS — qwen3.8 `limit.context=262144` |
| OpenCode workdir | PASS — isolated `/private/tmp/ao-qwen38-256k-pilot` |
| Ollama endpoint | PASS — local endpoint responded |
| Configured pilot model | PASS — `qwen3.8:latest` / 27.3B listed |
| Ollama model context | PASS — API model metadata and loaded server both report `262144` |

The preflight passed after the operator's 2026-09-04 256K requirement
superseded the prior 128K value. It verified the exact OpenCode configured
window and the Ollama model capability before dispatch.

The bounded real pilot used the fresh OpenCode session
`ses_f967458d7ffetJVydokCqepp2K` in the disposable directory. It read only
`PILOT.md`, returned exactly `QWEN38_256K_PILOT_OK`, made no file changes, and
loaded `qwen3.8:latest` through Ollama. `ollama ps` and the live
`llama-server` command both reported context `262144`.

After the pilot, Ollama was deliberately restored to `qwen3.6:35b`. A real
response (`QWEN36_256K_RESTORED`), `ollama ps`, and the live `llama-server`
command confirm the restored model and context `262144`. The persistent
`com.ollama.serve` environment and both OpenCode model definitions are also
`262144`, preventing the prior 32K default from being selected after restart.

No Agent Orchestrator LaunchAgent operation, production `/slot` mutation, or
deployment was performed. The deterministic fake pilot remains recorded in
[AO-33 evidence](./ao-33-deterministic-acceptance.md).
