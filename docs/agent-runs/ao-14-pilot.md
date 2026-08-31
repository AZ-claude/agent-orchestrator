# AO-14 disposable pilot evidence

The pilot is fixture-backed and documentation-only. It does not connect to
`/slot`, production databases, Windows Scheduler, GitHub Projects, or deploys.

`npm test -- pilot` proves, in one deterministic run:

- two SAFE tasks dispatch within the worker bound;
- an EXCLUSIVE task is blocked while a SAFE worker is running;
- worker validation enters independent review, returns REWORK once, resumes
  the same Luna path, then reaches APPROVE and remote-base verification;
- a rate-limit observation becomes `pause` with a retry time;
- restart reconciliation resumes the saved Luna session.

The fixture uses no LLM call; it is a disposable acceptance test for the
controller and state machine.
