import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const selectors = process.argv.slice(2);
const files = (await readdir("dist/test"))
  .filter((file) => file.endsWith(".test.js"))
  .filter((file) => selectors.length === 0 || selectors.some((selector) => file.startsWith(`${selector}.`) || file.startsWith(`${selector}-`) || file.includes(`.${selector}.`)))
  .sort()
  .map((file) => join("dist/test", file));
if (files.length === 0) {
  console.error(`No test suite matches selector(s): ${selectors.join(", ") || "<none>"}`);
  process.exitCode = 1;
} else {
  const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
