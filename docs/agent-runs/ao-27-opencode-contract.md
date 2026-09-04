# AO-27 — OpenCode/Ollama local-worker contract investigation

Date: 2026-09-03 JST
Status: **PASS (contract recorded; real local workload completed)**

Independent review: **APPROVE** (read-only contract/evidence review)

## Read-only observations

- OpenCode is installed at `/Users/eita/.opencode/bin/opencode`, version `1.18.23`.
- `opencode run --help` documents `--format json`, `--model provider/model`, and
  `--session session-id`; therefore the adapter can use a fresh `run` and a
  supported session resume without inventing Codex UUID/event semantics.
- OpenCode supports `--print-logs`, `--dir`, and non-interactive `run`. The
  adapter uses argument arrays with `shell: false`; it does not construct a
  shell command.
- Ollama is installed at `/opt/homebrew/bin/ollama`, client version `0.32.15`,
  and its local endpoint is reachable at `http://127.0.0.1:11434`.
- The 2026-09-04 operator requirement supersedes the prior 128K value: both
  `qwen3.6:35b` and `qwen3.8:latest` have an OpenCode `limit.context` of
  exactly `262144`. Ollama reports `qwen3.8:latest` as a 27.3B model with a
  `262144`-token capability.

## Contract used by the implementation

The local adapter controls `opencode run` as a child process:

```text
fresh:  run --format json --model <provider/model> <message>
resume: run --format json --model <provider/model> --session <session-id> <message>
```

The parent observes PID, exit code/signal/spawn error, stderr, JSON event
lines, and an explicitly emitted session identifier when present. Fresh
Recovery is always a fresh invocation and receives durable evidence only.
Retirement sends SIGTERM and escalates to SIGKILL only through the injected
process handle. Durable local logs contain non-secret machine evidence, not
prompts or private provider transcripts.

AO-34 subsequently proved a real fresh OpenCode session and bounded
read-only Qwen3.8 local-worker invocation. Fake fixtures remain responsible
for controlled rate/usage/quota and termination branches.

## Evidence

- Non-secret captured facts: `test/fixtures/opencode/contract.json`.
- Fixture parser: `test/opencode-contract.test.ts`.
- No Agent Orchestrator LaunchAgent was installed, loaded, registered, or
  changed.
- No production `/slot` work was performed.
