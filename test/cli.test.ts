import assert from "node:assert/strict";
import test from "node:test";
import { parseCli, runCli } from "../src/cli/index.js";
import { PrivacySafeLogger } from "../src/logging/index.js";

test("CLI exposes only the five operational commands", () => {
  assert.equal(parseCli(["bootstrap"]), "bootstrap");
  assert.equal(parseCli(["run-once"]), "run-once");
  assert.throws(() => parseCli(["dashboard"]), /usage/);
});

test("daemon invokes run-once without LLM polling and logger redacts secrets", async () => {
  const events: string[] = []; let runs = 0;
  await assert.rejects(() => runCli(["daemon"], { bootstrap: async () => undefined, runOnce: async () => { runs += 1; if (runs === 1) throw new Error("stop"); }, reconcile: async () => undefined, status: async () => undefined, sleep: async () => undefined }, new PrivacySafeLogger((line) => events.push(line))), /stop/);
  assert.equal(runs, 1);
  assert.doesNotMatch(events[0] ?? "", /secret|token|prompt/i);
});

test("logger redacts sensitive text in ordinary and nested values", () => {
  const events: string[] = [];
  new PrivacySafeLogger((line) => events.push(line)).info("event", { message: "password=abc", values: ["api key", "safe"] });
  assert.equal(events.length, 1);
  assert.doesNotMatch(events[0] ?? "", /password|abc|api key/i);
  assert.match(events[0] ?? "", /safe/);
});
