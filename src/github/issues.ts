import { CommandResult, CommandRunner, defaultCommandRunner } from "../git/index.js";
import { ManifestTask, TaskManifest, EXECUTION_STATES, ExecutionState } from "../config/index.js";

export interface IssueSnapshot {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: "OPEN" | "CLOSED";
  readonly labels: readonly string[];
  readonly parentNumber: number | null;
  readonly blockedBy: readonly number[];
}
export interface GhClient { run(args: readonly string[]): Promise<CommandResult>; }
export interface ProjectedIssues { readonly parent: IssueSnapshot; readonly tasks: ReadonlyMap<string, IssueSnapshot>; }
export const PILOT_GH_REPO = "AZ-claude/slot";

export class GhCommandError extends Error {
  constructor(readonly args: readonly string[], readonly result: CommandResult) {
    super(`gh ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`);
    this.name = "GhCommandError";
  }
}

export class CliGhClient implements GhClient {
  constructor(private readonly runCommand: CommandRunner = defaultCommandRunner) {}
  run(args: readonly string[]): Promise<CommandResult> { return this.runCommand("gh", [...args, "--repo", PILOT_GH_REPO]); }
}

export const STATE_LABEL = (state: ExecutionState): string => `ao:state:${state}`;
export const TASK_MARKER = (taskId: string): string => `<!-- agent-orchestrator:task=${taskId} -->`;
export const PARENT_MARKER = "<!-- agent-orchestrator:parent -->";

export class GitHubIssueProjector {
  constructor(private readonly client: GhClient) {}

  async project(manifest: TaskManifest, existingParent?: IssueSnapshot): Promise<ProjectedIssues> {
    await this.ensureStateLabels();
    const parent = existingParent ?? await this.findByMarker(PARENT_MARKER) ?? await this.createIssue(`${manifest.handoff.id} orchestration`, `${PARENT_MARKER}\nCanonical board: ${manifest.handoff.board}`);
    const tasks = new Map<string, IssueSnapshot>();
    for (const task of manifest.tasks) {
      const found = await this.findByMarker(TASK_MARKER(task.id));
      const issue = found ?? await this.createIssue(task.title, this.taskBody(manifest, task, parent.number), parent.number, undefined);
      if (found === null) await this.setState(issue.number, "ready");
      if (found !== null && issue.parentNumber !== parent.number) await this.setParent(issue.number, parent.number);
      tasks.set(task.id, { ...issue, labels: found === null ? [STATE_LABEL("ready")] : issue.labels, parentNumber: parent.number });
    }
    for (const task of manifest.tasks) {
      const issue = tasks.get(task.id);
      if (issue === undefined) continue;
      const dependencyNumbers = task.dependsOn.map((dependency) => tasks.get(dependency)?.number).filter((number): number is number => number !== undefined);
      const current = new Set(issue.blockedBy);
      for (const old of current) if (!dependencyNumbers.includes(old)) await this.removeBlockedBy(issue.number, old);
      await this.addBlockedBy(issue.number, dependencyNumbers.filter((number) => !current.has(number)));
      tasks.set(task.id, { ...issue, blockedBy: dependencyNumbers });
    }
    return { parent, tasks };
  }

  async setState(issueNumber: number, state: ExecutionState): Promise<void> {
    const result = await this.client.run(["issue", "edit", String(issueNumber), "--remove-label", EXECUTION_STATES.map((item) => STATE_LABEL(item)).join(","), "--add-label", STATE_LABEL(state)]);
    if (result.code !== 0) throw new GhCommandError(["issue", "edit"], result);
  }

  async comment(issueNumber: number, body: string): Promise<void> {
    const result = await this.client.run(["issue", "comment", String(issueNumber), "--body", body]);
    if (result.code !== 0) throw new GhCommandError(["issue", "comment"], result);
  }

  async close(issueNumber: number): Promise<void> {
    const result = await this.client.run(["issue", "close", String(issueNumber)]);
    if (result.code !== 0) throw new GhCommandError(["issue", "close"], result);
  }

  async addBlockedBy(issueNumber: number, dependencyNumbers: readonly number[]): Promise<void> {
    for (const dependencyNumber of dependencyNumbers) {
      const result = await this.client.run(["issue", "edit", String(issueNumber), "--add-blocked-by", String(dependencyNumber)]);
      if (result.code !== 0) throw new GhCommandError(["issue", "edit"], result);
    }
  }

  private async ensureStateLabels(): Promise<void> {
    for (const state of EXECUTION_STATES) {
      const result = await this.client.run(["label", "create", STATE_LABEL(state), "--force"]);
      if (result.code !== 0) throw new GhCommandError(["label", "create"], result);
    }
  }

  async removeBlockedBy(issueNumber: number, dependencyNumber: number): Promise<void> {
    const result = await this.client.run(["issue", "edit", String(issueNumber), "--remove-blocked-by", String(dependencyNumber)]);
    if (result.code !== 0) throw new GhCommandError(["issue", "edit"], result);
  }

  private async setParent(issueNumber: number, parentNumber: number): Promise<void> {
    const result = await this.client.run(["issue", "edit", String(issueNumber), "--parent", String(parentNumber)]);
    if (result.code !== 0) throw new GhCommandError(["issue", "edit"], result);
  }

  async readOpen(): Promise<readonly IssueSnapshot[]> {
    const result = await this.client.run(["issue", "list", "--state", "all", "--limit", "1000", "--json", "number,title,body,state,labels,parent,blockedBy"]);
    if (result.code !== 0) throw new GhCommandError(["issue", "list"], result);
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) throw new Error("gh issue list returned a non-array");
    return parsed.map(parseIssue);
  }

  private async createIssue(title: string, body: string, parentNumber?: number, blockedBy?: readonly number[]): Promise<IssueSnapshot> {
    const args = ["issue", "create", "--title", title, "--body", body];
    if (parentNumber !== undefined) args.push("--parent", String(parentNumber));
    if (blockedBy !== undefined && blockedBy.length > 0) args.push("--blocked-by", blockedBy.join(","));
    const result = await this.client.run(args);
    if (result.code !== 0) throw new GhCommandError(["issue", "create"], result);
    const parsed = parseCreatedIssue(result.stdout, title, body);
    return parsed;
  }
  private async findByMarker(marker: string): Promise<IssueSnapshot | null> {
    const issues = await this.readOpen();
    return issues.find((issue) => issue.body.includes(marker)) ?? null;
  }
  private taskBody(manifest: TaskManifest, task: ManifestTask, parentNumber: number): string {
    return [TASK_MARKER(task.id), `Canonical task: ${manifest.handoff.board}#${task.id}`, `Depends on: ${task.dependsOn.join(", ") || "none"}`, `Parallel: ${task.parallel}`, `Human gate: ${task.humanGate}`, `Parent issue: #${parentNumber}`].join("\n");
  }
}

function parseCreatedIssue(output: string, title: string, body: string): IssueSnapshot {
  const trimmed = output.trim();
  const numberMatch = trimmed.match(/(?:issues\/|#)(\d+)\/?$/);
  if (numberMatch?.[1] === undefined) throw new Error("gh issue create did not return an issue URL/number");
  return { number: Number(numberMatch[1]), title, body, state: "OPEN", labels: [], parentNumber: null, blockedBy: [] };
}

function parseIssue(value: unknown): IssueSnapshot {
  if (!isRecord(value) || typeof value.number !== "number" || typeof value.title !== "string" || typeof value.body !== "string" || (value.state !== "OPEN" && value.state !== "CLOSED")) throw new Error("invalid GitHub issue snapshot");
  const labels = Array.isArray(value.labels) ? value.labels.map((label) => typeof label === "string" ? label : isRecord(label) && typeof label.name === "string" ? label.name : null).filter((label): label is string => label !== null) : [];
  const parentNumber = isRecord(value.parent) && typeof value.parent.number === "number" ? value.parent.number : typeof value.parent === "number" ? value.parent : null;
  const blockedBy = Array.isArray(value.blockedBy) ? value.blockedBy.map((item) => typeof item === "number" ? item : isRecord(item) && typeof item.number === "number" ? item.number : null).filter((item): item is number => item !== null) : [];
  return { number: value.number, title: value.title, body: value.body, state: value.state, labels, parentNumber, blockedBy };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
