# AO-33 Deterministic fake-adapter acceptance evidence

Result: **PASS** (disposable fixtures only, 2026-09-03 JST)

Independent review: **APPROVE** (read-only review of fixture scope, gates,
and host-mutation boundary)

`runPilotFixture()` and focused tests prove cloud regression; OpenCode fresh,
resume, fresh Recovery, failure/spawn/crash, PID/session/log/retirement;
cloud/local/auto and Primary/Recovery selection; explicit rate/usage/quota
fallback, fresh local continuation, latch/reset; fallback separation from
REWORK/STUCK/Recovery; unavailable local fail-closed; exact 262144 preflight;
provider-neutral checkpoint evidence; Independent Reviewer approval before
deterministic merge; reviewed-HEAD and authority gates; and no host mutation.

The fixture uses only `/tmp`-style disposable paths and injected processes.
It does not call `launchctl`, `manage.sh install`, the production `/slot`
runtime, a real model, or a deployment.

Required commands passed:

```sh
npm test
npm run build
npm run lint
packaging/launchd/manage.sh verify
```
