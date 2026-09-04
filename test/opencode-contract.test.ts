import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("AO-27 fixture records observed OpenCode/Ollama facts without claiming unavailable behavior", async () => {
  const contract = JSON.parse(await readFile("test/fixtures/opencode/contract.json", "utf8")) as {
    opencode: { version: string; shell: boolean; newInvocation: string[]; resumeInvocation: string[] };
    ollama: { version: string; availability: string };
    configuredLocalStack: { contextTokens: number; contextAuthority: string; handoffModelMismatch: string };
    unavailableFacts: string[];
    safety: { credentials: string; privateConversation: string; launchAgentMutation: boolean; productionMutation: boolean; contextDowngrade: boolean };
  };
  assert.match(contract.opencode.version, /^1\.18\.23$/);
  assert.equal(contract.opencode.shell, false);
  assert.deepEqual(contract.opencode.newInvocation.slice(0, 4), ["run", "--format", "json", "--model"]);
  assert.ok(contract.opencode.resumeInvocation.includes("--session"));
  assert.match(contract.ollama.version, /^0\.32\.15$/);
  assert.match(contract.ollama.availability, /unavailable/);
  assert.equal(contract.configuredLocalStack.contextTokens, 262144);
  assert.match(contract.configuredLocalStack.contextAuthority, /opencode\.jsonc/);
  assert.match(contract.configuredLocalStack.handoffModelMismatch, /qwen3\.6:35b/);
  assert.ok(contract.unavailableFacts.length >= 3);
  assert.equal(contract.safety.credentials, "not recorded");
  assert.equal(contract.safety.privateConversation, "not recorded");
  assert.equal(contract.safety.launchAgentMutation, false);
  assert.equal(contract.safety.productionMutation, false);
  assert.equal(contract.safety.contextDowngrade, false);
});
