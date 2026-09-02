import { fileURLToPath } from "node:url";

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write("usage: agent-orchestrator <bootstrap|run-once|daemon|reconcile|status>\n");
    return;
  }
  const [{ runCli }, { createCliOperations }] = await Promise.all([
    import("../dist/src/cli/cli.js"),
    import("../dist/src/cli/app.js"),
  ]);
  await runCli(argv, createCliOperations({ cwd, env }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
