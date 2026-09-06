# AO-51 concrete executable runtime composition

Date: 2026-09-06 JST
Status: **PASS**

`bin/agent-orchestrator.mjs run-once` now reaches the concrete composition
without a runtime factory injection. The factory builds the target-aware
GitHub Issue boundary, checkpoint store, Git adapter, configured cloud/local
worker router and durable dispatcher, concrete read-only reviewer, machine
session observer, worker limit, and explicit durable Human Gate approvals.

The entrypoint test invokes the actual bin file with a disposable target and a
fake GitHub executable; it verifies target identity and reaches the idle poll
path without starting a Worker or touching production. Runtime and merge paths
retain explicit reviewed-HEAD and Human Gate checks.

Verification: `npm test -- runtime-factory entrypoint runtime`, `npm run build`,
and `npm run lint` pass. LaunchAgent installation/loading/registration and
`/slot`/`/kiji` runtime operations were not performed.
