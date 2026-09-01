import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const selectors = process.argv.slice(2);
async function testFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? testFiles(path) : entry.name.endsWith(".test.js") ? [path] : [];
  }));
  return nested.flat();
}
const files = (await testFiles("dist/test"))
  .filter((file) => file.endsWith(".test.js"))
  .filter((file) => selectors.length === 0 || selectors.some((selector) => file.split("/").some((part) => part === selector || part.startsWith(`${selector}.`) || part.startsWith(`${selector}-`))))
  .sort()
  .map((file) => file);
if (files.length === 0) {
  console.error(`No test suite matches selector(s): ${selectors.join(", ") || "<none>"}`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
