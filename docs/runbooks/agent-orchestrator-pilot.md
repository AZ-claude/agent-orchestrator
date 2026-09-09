# Agent Orchestrator permanent pilot

The permanent pilot is the fixed `AZ-claude/agent-orchestrator-pilot` repository
on `main`, through the dedicated clone at
`/Users/eita/.local/share/agent-orchestrator/targets/pilot`. It is separate from
the production `AZ-claude/slot@master` boundary and from the normal
`/Users/eita/projects/slot` checkout.

Pilot state is stored at `/Users/eita/.local/state/agent-orchestrator-pilot` and
pilot logs at `/Users/eita/Library/Logs/AgentOrchestratorPilot`. The pilot uses
the same concrete worker, local preflight, reviewer, checkpoint, merge, and
recovery composition as production. Only the pilot LaunchAgent identity differs:
`com.az-claude.agent-orchestrator.pilot`.

The single acceptance task adds `pilot-acceptance-001.txt` with the exact marker
`agent-orchestrator-pilot-v1`. Idle polling must not create new Issues or tasks.
