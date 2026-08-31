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
