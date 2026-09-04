import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("final acceptance records all v1 criteria and pilot boundary", async () => {
  const evidence = await readFile("docs/agent-runs/ao-15-final-acceptance.md", "utf8");
  for (let number = 1; number <= 18; number += 1) assert.match(evidence, new RegExp(`\\| ${number} \\|`));
  assert.match(evidence, /Status: \*\*PASS/);
  assert.match(evidence, /does not implement multi-repo/);
  assert.match(evidence, /No live `\/slot` experiment/);
});

test("AO-26 refresh records executable entrypoint and read-only preflight readiness", async () => {
  const evidence = await readFile("docs/agent-runs/ao-26-preinstall-delta-final-acceptance.md", "utf8");
  assert.match(evidence, /Status: \*\*PASS/);
  assert.match(evidence, /bin\/agent-orchestrator\.mjs/);
  assert.match(evidence, /preflight\.sh/);
  assert.match(evidence, /read-only/);
  assert.match(evidence, /No installation was performed/);
  assert.match(evidence, /AO-16/);
});

test("AO-35 records whole-product Qwen/OpenCode acceptance and real 256K pilot", async () => {
  const evidence = await readFile("docs/agent-runs/ao-35-final-terra-acceptance.md", "utf8");
  assert.match(evidence, /Status: \*\*PASS/);
  for (const criterion of ["Cloud Luna/Codex compatibility", "OpenCode local adapter", "Configured local Qwen model path", "Explicit modes", "Auto fallback", "Independent Reviewer", "Provider-neutral durable evidence", "exact 262144", "AO-16 separation"]) assert.match(evidence, new RegExp(criterion));
  assert.match(evidence, /AO-34/);
  assert.match(evidence, /qwen3\.8:latest/);
  assert.match(evidence, /262144/);
  assert.match(evidence, /qwen3\.6:35b/);
  assert.match(evidence, /LaunchAgent install\/load\/register remains unexecuted/);
  for (let number = 27; number <= 34; number += 1) {
    const review = await readFile(`docs/agent-runs/ao-${number}-${number === 27 ? "opencode-contract" : number === 28 ? "independent-review" : number === 29 ? "independent-review" : number === 30 ? "independent-review" : number === 31 ? "independent-review" : number === 32 ? "independent-review" : number === 33 ? "deterministic-acceptance" : "qwen-pilot"}.md`, "utf8");
    assert.match(review, /Independent [Rr]eview/);
    assert.match(review, /APPROVE|PASS/);
  }
  const board = await readFile("docs/task-boards/2026-09-03-qwen-opencode-worker-preinstall-delta.md", "utf8");
  const manifest = await readFile("tasks/agent-orchestrator-qwen-opencode-worker-preinstall-delta.yaml", "utf8");
  for (let number = 27; number <= 35; number += 1) {
    assert.match(board, new RegExp(`### AO-${number}[^\\n]*\\n\\n- State: DONE`));
    assert.match(manifest, new RegExp(`- id: AO-${number}\\n[\\s\\S]*?state: DONE`));
  }
});
