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
