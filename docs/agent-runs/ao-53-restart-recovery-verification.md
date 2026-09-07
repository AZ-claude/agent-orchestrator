# AO-53 Restart / recovery verification

Status: **PASS**

The real disposable boundary from AO-52 was followed by controlled restart
coverage. Runtime tests prove that running and worker-done checkpoints do not
duplicate Worker dispatch, and that a reviewed-before-merge checkpoint resumes
without re-review or redispatch. A controlled test changes the pushed source
HEAD after approval; the runtime blocks with `MERGE_GATE_FAILED`, keeps the
Issue open, and does not merge or close it.

The controlled detached-worker test additionally proves that two independent
SAFE tasks with `maxLunaWorkers=2` retain distinct PID/worktree/branch
ownership while both are running; EXCLUSIVE work is excluded from that
overlap and the scheduler suite proves `maxLunaWorkers=1` is serial. The auto
cloud availability-limit -> local fallback test persists the provider/fallback
fact, recreates the Router/RuntimeComposition, resumes the same local
provider/session, performs no duplicate cloud retry, and retains the shared
local lease contract.

Verification: `npm test -- runtime checkpoint reconcile controller` — PASS;
full `npm test` — PASS (117 tests); `npm run build` — PASS; `npm run lint` — PASS;
`packaging/launchd/manage.sh verify` — PASS. No LaunchAgent install/load/
registration and no `/slot`/`/kiji` operation occurred.
