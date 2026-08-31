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

export class GhCommandError extends Error {
  constructor(readonly args: readonly string[], readonly result: CommandResult) {
    super(`gh ${args.join(" ")} failed (${result.code}): ${result.stderr || result.stdout}`);
    this.name = "GhCommandError";
  }
}

export class CliGhClient implements GhClient {
  constructor(private readonly runCommand: CommandRunner = defaultCommandRunner) {}
  run(args: readonly string[]): Promise<CommandResult> { return this.runCommand("gh", args); }
}

export const STATE_LABEL = (state: ExecutionState): string => `ao:state:${state}`;
export const TASK_MARKER = (taskId: string): string => `<!-- agent-orchestrator:task=${taskId} -->`;
export const PARENT_MARKER = "<!-- agent-orchestrator:parent -->";

export class GitHubIssueProjector {
  constructor(private readonly client: GhClient) {}

  async project(manifest: TaskManifest, existingParent?: IssueSnapshot): Promise<ProjectedIssues> {
    const parent = existingParent ?? await this.createIssue(`${manifest.handoff.id} orchestration`, `${PARENT_MARKER}\nCanonical board: ${manifest.handoff.board}`);
    const tasks = new Map<string, IssueSnapshot>();
    for (const task of manifest.tasks) {
      const found = await this.findByMarker(TASK_MARKER(task.id));
      const issue = found ?? await this.createIssue(task.title, this.taskBody(manifest, task, parent.number));
      await this.setState(issue.number, "ready");
      tasks.set(task.id, { ...issue, labels: [STATE_LABEL("ready")], parentNumber: parent.number, blockedBy: [] });
    }
    return { parent, tasks };
  }

  async setState(issueNumber: number, state: ExecutionState): Promise<void> {
    const result = await this.client.run(["issue", "edit", String(issueNumber), "--remove-label", ...EXECUTION_STATES.map((item) => STATE_LABEL(item)), "--add-label", STATE_LABEL(state)]);
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

  async readOpen(): Promise<readonly IssueSnapshot[]> {
    const result = await this.client.run(["issue", "list", "--state", "all", "--json", "number,title,body,state,labels"]);
    if (result.code !== 0) throw new GhCommandError(["issue", "list"], result);
    const parsed = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(parsed)) throw new Error("gh issue list returned a non-array");
    return parsed.map(parseIssue);
  }

  private async createIssue(title: string, body: string): Promise<IssueSnapshot> {
    const result = await this.client.run(["issue", "create", "--title", title, "--body", body, "--json", "number,title,body,state,labels"]);
    if (result.code !== 0) throw new GhCommandError(["issue", "create"], result);
    return parseIssue(JSON.parse(result.stdout));
  }
  private async findByMarker(marker: string): Promise<IssueSnapshot | null> {
    const issues = await this.readOpen();
    return issues.find((issue) => issue.body.includes(marker)) ?? null;
  }
  private taskBody(manifest: TaskManifest, task: ManifestTask, parentNumber: number): string {
    return [TASK_MARKER(task.id), `Canonical task: ${manifest.handoff.board}#${task.id}`, `Depends on: ${task.dependsOn.join(", ") || "none"}`, `Parallel: ${task.parallel}`, `Human gate: ${task.humanGate}`, `Parent issue: #${parentNumber}`].join("\n");
  }
}

function parseIssue(value: unknown): IssueSnapshot {
  if (!isRecord(value) || typeof value.number !== "number" || typeof value.title !== "string" || typeof value.body !== "string" || (value.state !== "OPEN" && value.state !== "CLOSED")) throw new Error("invalid GitHub issue snapshot");
  const labels = Array.isArray(value.labels) ? value.labels.map((label) => typeof label === "string" ? label : isRecord(label) && typeof label.name === "string" ? label.name : null).filter((label): label is string => label !== null) : [];
  return { number: value.number, title: value.title, body: value.body, state: value.state, labels, parentNumber: null, blockedBy: [] };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
