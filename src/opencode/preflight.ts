import { access, readFile } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { AO_LOCAL_MODEL, LocalWorkerConfig, REQUIRED_LOCAL_CONTEXT } from "../config/index.js";

const execFile = promisify(nodeExecFile);
export { REQUIRED_LOCAL_CONTEXT };

export interface PreflightCheck { readonly name: string; readonly pass: boolean; readonly detail: string; }
export interface LocalPreflightResult { readonly pass: boolean; readonly checks: readonly PreflightCheck[]; readonly provider: "local"; readonly model: string; readonly contextTokens: 262144; }

export interface LocalPreflightProbe {
  readonly pathExists?: (path: string) => Promise<boolean>;
  readonly runVersion?: (executable: string, cwd: string) => Promise<{ readonly pass: boolean; readonly detail: string }>;
  readonly readConfig?: (path: string) => Promise<string>;
  readonly listModels?: (baseUrl: string) => Promise<readonly string[]>;
  readonly modelContext?: (baseUrl: string, model: string) => Promise<number | null>;
  readonly serviceContext?: () => Promise<number | null>;
}

/** Read-only local-stack validation. It never starts a process or changes config. */
export async function preflightLocalWorker(config: LocalWorkerConfig, probe: LocalPreflightProbe = {}): Promise<LocalPreflightResult> {
  const checks: PreflightCheck[] = [];
  checks.push({ name: "fixed-model", pass: config.model === AO_LOCAL_MODEL, detail: config.model === AO_LOCAL_MODEL ? `fixed model=${AO_LOCAL_MODEL}` : `model must equal ${AO_LOCAL_MODEL}` });
  checks.push({ name: "requested-context", pass: config.contextTokens === REQUIRED_LOCAL_CONTEXT, detail: config.contextTokens === REQUIRED_LOCAL_CONTEXT ? "requested context=262144" : "requested context is not exactly 262144" });
  const exists = probe.pathExists ?? (async (path: string) => { try { await access(path); return true; } catch { return false; } });
  const readConfig = probe.readConfig ?? ((path: string) => readFile(path, "utf8"));
  const runVersion = probe.runVersion ?? defaultVersionProbe;
  const listModels = probe.listModels ?? defaultListModels;
  const modelContext = probe.modelContext ?? defaultModelContext;
  const serviceContext = probe.serviceContext ?? defaultServiceContext;

  checks.push(pathCheck("opencode-executable", config.executable, await exists(config.executable)));
  checks.push(pathCheck("workdir", config.workdir, await exists(config.workdir)));
  checks.push(pathCheck("opencode-config", config.configPath, await exists(config.configPath)));

  const version = await runVersion(config.executable, config.workdir);
  checks.push({ name: "opencode-available", pass: version.pass, detail: version.detail });

  let configured = false;
  try {
    const document = parseJsonc(await readConfig(config.configPath));
    configured = hasExactContextConfig(document, config.model);
    checks.push({ name: "opencode-model-context", pass: configured, detail: configured ? `configured context=${REQUIRED_LOCAL_CONTEXT}` : "configured provider/model limit.context is not exactly 262144" });
  } catch {
    checks.push({ name: "opencode-config-readable", pass: false, detail: "configuration is unavailable or invalid" });
  }

  let models: readonly string[] = [];
  try {
    models = await listModels(config.ollamaBaseUrl);
    const model = modelName(config.model);
    checks.push({ name: "ollama-endpoint", pass: true, detail: "local endpoint responded" });
    checks.push({ name: "ollama-model-available", pass: models.includes(model), detail: models.includes(model) ? "configured model is listed" : "configured model is not listed" });
  } catch {
    checks.push({ name: "ollama-endpoint", pass: false, detail: "local endpoint is unavailable" });
    checks.push({ name: "ollama-model-available", pass: false, detail: "model availability cannot be inspected" });
  }

  let actualContext: number | null = null;
  try {
    actualContext = await modelContext(config.ollamaBaseUrl, modelName(config.model));
    checks.push({ name: "ollama-model-context", pass: actualContext !== null && actualContext >= REQUIRED_LOCAL_CONTEXT, detail: actualContext === null ? "model context is unavailable" : actualContext >= REQUIRED_LOCAL_CONTEXT ? `model supports context=${actualContext}; configured execution context=${REQUIRED_LOCAL_CONTEXT}` : `model context=${actualContext} is below required ${REQUIRED_LOCAL_CONTEXT}` });
  } catch {
    checks.push({ name: "ollama-model-context", pass: false, detail: "model context cannot be inspected" });
  }

  let persistentContext: number | null = null;
  try {
    persistentContext = await serviceContext();
    checks.push({ name: "ollama-service-context", pass: persistentContext === REQUIRED_LOCAL_CONTEXT, detail: persistentContext === null ? "persistent Ollama service context is unavailable" : persistentContext === REQUIRED_LOCAL_CONTEXT ? `persistent service context=${REQUIRED_LOCAL_CONTEXT}` : `persistent service context=${persistentContext}; required ${REQUIRED_LOCAL_CONTEXT}` });
  } catch {
    checks.push({ name: "ollama-service-context", pass: false, detail: "persistent Ollama service context cannot be inspected" });
  }

  // OpenCode's exact configuration controls the requested execution window.
  // Ollama reports the model's maximum supported window, which must be at
  // least that requested value; requiring equality would reject a model that
  // safely supports 256K simply because it can support a larger window.
  void configured;
  void actualContext;
  void persistentContext;
  return { provider: "local", model: config.model, contextTokens: REQUIRED_LOCAL_CONTEXT, pass: checks.every((check) => check.pass), checks };
}

function pathCheck(name: string, path: string, pass: boolean): PreflightCheck {
  return { name, pass, detail: pass ? "path is accessible" : "path is unavailable" };
}

function modelName(model: string): string {
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

function hasExactContextConfig(value: unknown, model: string): boolean {
  if (!isRecord(value) || !isRecord(value.provider)) return false;
  const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "ollama";
  const configuredProvider = value.provider[provider];
  if (!isRecord(configuredProvider) || !isRecord(configuredProvider.models)) return false;
  const modelConfig = configuredProvider.models[modelName(model)];
  return isRecord(modelConfig) && isRecord(modelConfig.limit) && modelConfig.limit.context === REQUIRED_LOCAL_CONTEXT;
}

async function defaultVersionProbe(executable: string, cwd: string): Promise<{ readonly pass: boolean; readonly detail: string }> {
  try {
    const result = await execFile(executable, ["--version"], { cwd, maxBuffer: 64 * 1024 });
    return { pass: true, detail: `OpenCode ${String(result.stdout).trim().slice(0, 64)}` };
  } catch {
    return { pass: false, detail: "OpenCode --version failed" };
  }
}

async function defaultListModels(baseUrl: string): Promise<readonly string[]> {
  const response = await fetch(`${baseUrl}/api/tags`);
  if (!response.ok) throw new Error(`Ollama tags returned ${response.status}`);
  const body = await response.json() as unknown;
  if (!isRecord(body) || !Array.isArray(body.models)) throw new Error("Ollama tags response is invalid");
  return body.models.flatMap((item) => isRecord(item) && typeof item.name === "string" ? [item.name] : []);
}

async function defaultModelContext(baseUrl: string, model: string): Promise<number | null> {
  const response = await fetch(`${baseUrl}/api/show`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model }) });
  if (!response.ok) throw new Error(`Ollama show returned ${response.status}`);
  const body = await response.json() as unknown;
  return findContext(body);
}

async function defaultServiceContext(): Promise<number | null> {
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  const service = uid === "" ? "gui/com.ollama.serve" : `gui/${uid}/com.ollama.serve`;
  const result = await execFile("launchctl", ["print", service], { maxBuffer: 64 * 1024 });
  return findServiceContext(`${String(result.stdout)}\n${String(result.stderr)}`);
}

function findServiceContext(value: string): number | null {
  const match = value.match(/OLLAMA_(?:CONTEXT_LENGTH|NUM_CTX)\s*(?:=>|=|:)\s*(\d+)/i);
  return match?.[1] === undefined ? null : Number(match[1]);
}

function findContext(value: unknown): number | null {
  if (isRecord(value)) {
    for (const [key, candidate] of Object.entries(value)) {
      if ((key === "context_length" || key === "contextLength" || key === "num_ctx" || key.endsWith(".context_length")) && typeof candidate === "number") return candidate;
    }
    for (const nested of Object.values(value)) { const found = findContext(nested); if (found !== null) return found; }
  }
  if (Array.isArray(value)) for (const item of value) { const found = findContext(item); if (found !== null) return found; }
  return null;
}

function parseJsonc(source: string): unknown {
  // The inspected config is JSONC but contains no strings with comment-like
  // syntax. Strip only comments that start outside a JSON string.
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (inString) { output += char; if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === "/" && next === "/") { while (index < source.length && source[index] !== "\n") index += 1; output += "\n"; continue; }
    if (char === "/" && next === "*") { index += 2; while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1; index += 1; continue; }
    output += char;
  }
  return JSON.parse(output.replace(/,\s*([}\]])/g, "$1")) as unknown;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
