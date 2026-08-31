import assert from "node:assert/strict";
import test from "node:test";
import { matchesGlob } from "../src/git/index.js";

test("scope glob matching is repository relative and supports star forms", () => {
  assert.equal(matchesGlob("src/config/schema.ts", "src/config/**"), true);
  assert.equal(matchesGlob("src/config.ts", "src/config/**"), false);
  assert.equal(matchesGlob("package.json", "package.json"), true);
  assert.equal(matchesGlob("src/config/schema.ts", "test/**"), false);
});
