# Codex lifecycle fixtures

`exec-success.jsonl` is stdout captured from the installed `codex-cli 0.151.0`
with `codex exec --json --ephemeral` and a no-op prompt. Stderr is intentionally
not part of the JSONL fixture.

The installed CLI's observable event contract is:

- `thread.started` with `thread_id`
- `turn.started`
- `item.started`, `item.updated`, or `item.completed`
- `turn.completed` with `usage`
- `turn.failed` or `error` with a message

The installed contract has no typed rate-limit event or error code. The
ambiguous fixture therefore verifies that rate-limit prose remains
`not-observable`; it must not be treated as a rate-limit signal.

`started-only.jsonl` is the observed stream prefix shape used with a signalled
child process to verify crash observation. The resume test verifies the exact
saved-session command and session-id match using the same observed event
contract; no persistent live session is created by the tests.
