# Fixed local-Qwen allocation and common lease

Version: 1  
Authority: Terra task board `2026-09-04-fixed-local-qwen-allocation.md`

This is the non-secret contract shared by Agent Orchestrator and `/kiji` for
the host's one local Ollama inference lane.

| Owner | Workload | Model | Requested context |
|---|---|---|---:|
| `agent-orchestrator` | local implementation worker through OpenCode | `ollama/qwen3.8:latest` | `262144` |
| `kiji` | date/time note-draft Qwen work | `qwen3.6:35b` | `262144` |

The operator configures one absolute lease directory, for example:

```text
/Users/eita/.local/state/ollama-inference/lease
```

Both clients must use that exact path and the following version-1 record:

```json
{"schemaVersion":1,"owner":"agent-orchestrator|kiji","model":"<fixed-owner-model>","pid":123,"nonce":"<opaque-unique-id>","acquiredAt":"<ISO-8601>"}
```

The record contains no prompt, source text, credentials, conversation,
private reasoning, or task-derived model choice.

## Lifecycle contract

1. Create the lease directory atomically before any Ollama or OpenCode request.
2. Write `owner.json` only after the directory is acquired. A missing,
   malformed, or contradictory record is not safe to overwrite.
3. Hold the lease through child-process execution and all retirement/cleanup
   paths. Release only after the invocation has reached a terminal state.
4. A caller may wait only for its configured bounded interval. A busy or
   timed-out result is explicit, durable, and does not consume review/rework or
   recovery budget.
5. Stale recovery is owner-scoped: a client may reclaim only a well-formed
   record for its own owner whose recorded PID is demonstrably dead. It never
   removes or releases a foreign owner's record.
6. Release and stale recovery first create an exclusive `claim.json` inside
   the live lease directory, validate that claim's owner/PID/nonce, and
   re-read the live owner record before renaming the directory. A claim with a
   mismatched or malformed nonce is not replaced; a same-owner claim is
   recoverable only when its PID is demonstrably dead. This is the mutation
   gate for all compliant clients, so a delayed release cannot remove a newer
   lease.
7. Release compares owner, PID, and nonce before removing the directory. A
   mismatch produces `release-skipped` and leaves the current owner untouched.

The lease controls the single active inference lane. It does not preload,
unload, pull, or switch models and does not claim that both models can remain
resident concurrently. Lease evidence may record only `status`, `owner`,
`model`, and `pid`.
