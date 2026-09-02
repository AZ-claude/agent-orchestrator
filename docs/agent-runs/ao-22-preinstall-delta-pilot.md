# AO-22 pre-install delta pilot evidence

Status: PASS (disposable/local fixtures only)

The pilot is executed by `runPilotFixture()` and covers the delta acceptance
surface: Independent Reviewer approval before the daemon merge adapter,
reviewed-HEAD mismatch refusal, bounded same-session rework, repeated-finding
early STUCK, one fresh Recovery Worker with a required independent review,
confirmed PLAN_CONFLICT and global merge barrier, unrelated SAFE continuation,
revision/lifecycle evidence, resumable-session retention, retired-session
cleanup, and the authority/Human Gate boundary.

The fixture uses no GitHub API, no live Issue, no `/Users/eita/projects/slot`
runtime operation, no LaunchAgent command, no deployment, and no production
data or Scheduler mutation. AO-01–AO-16 pilot safety remains covered by the
existing fixture assertions for SAFE/EXCLUSIVE scheduling, rate-limit pause,
restart reconciliation, and repository-relative scope checks.

Required evidence commands:

```sh
npm test -- pilot
npm test
npm run build
npm run lint
```
