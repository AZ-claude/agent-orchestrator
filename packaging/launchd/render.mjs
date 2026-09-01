import { readFile, writeFile } from "node:fs/promises";

const [templatePath, outputPath, nodePath, cliPath, workdir, logDir] = process.argv.slice(2);
if ([templatePath, outputPath, nodePath, cliPath, workdir, logDir].some((value) => value === undefined || value === "")) {
  console.error("usage: node render.mjs TEMPLATE OUTPUT NODE CLI WORKDIR LOG_DIR");
  process.exitCode = 2;
} else {
  const template = await readFile(templatePath, "utf8");
  const values = { __NODE__: nodePath, __CLI__: cliPath, __WORKDIR__: workdir, __LOG_DIR__: logDir };
  const rendered = Object.entries(values).reduce((text, [placeholder, value]) => text.replaceAll(placeholder, xmlEscape(value)), template);
  if (/__[A-Z_]+__/.test(rendered)) throw new Error("unresolved LaunchAgent placeholder");
  await writeFile(outputPath, rendered, { encoding: "utf8", mode: 0o600 });
}

function xmlEscape(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
