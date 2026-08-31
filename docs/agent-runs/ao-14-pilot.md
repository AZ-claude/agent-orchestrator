# AO-14 disposable pilot evidence

The pilot is fixture-backed and documentation-only. It does not connect to
`/slot`, production databases, Windows Scheduler, GitHub Projects, or deploys.

`npm test -- pilot` proves, in one deterministic run (including positive and
negative scope assertions and side-effect assertions):

- two SAFE tasks dispatch within the worker bound;
- an EXCLUSIVE task is blocked while a SAFE worker is running;
- worker validation enters independent review, returns REWORK once, resumes
  the recorded Luna session path, then reaches APPROVE and records remote-base
  verification;
- a rate-limit observation becomes `pause` with the exact retry time;
- restart reconciliation resumes the saved Luna session and preserves its ID;
- the machine validator accepts `docs/**` and rejects `src/forbidden.ts`.

The fixture uses no LLM call; it is a disposable acceptance test for the
controller and state machine.
