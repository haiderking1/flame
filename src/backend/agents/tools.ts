import type { CatalogModel } from "../../contracts/models.js";

export const COLLABORATION_TOOLS = ["spawn_agent", "send_message", "followup_task", "wait_agent", "interrupt_agent", "list_agents"] as const;
export type CollaborationTool = typeof COLLABORATION_TOOLS[number];
export const isCollaborationTool = (name: string): name is CollaborationTool => (COLLABORATION_TOOLS as readonly string[]).includes(name);

export const WAIT = { defaultMs: 30_000, minMs: 10_000, maxMs: 3_600_000 };
// The models a spawned agent may be given instead of its parent's, shown to the model; the parent's own is preferred.
const OVERRIDE_MODELS = 5;

const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description: string) => ({ type: "string", description });
/** The collaboration tools, described for the model; the spawn description lists the models an agent may be given. */
export function collaborationTools(models: readonly CatalogModel[]) {
  const overrides = models.slice(0, OVERRIDE_MODELS).map(model => `- \`${model.id}\`: ${model.description || model.name}${model.reasoningLevels.length ? ` Reasoning efforts: ${model.reasoningLevels.map(level => level.effort).join(", ")}${model.defaultReasoning ? ` (default ${model.defaultReasoning})` : ""}.` : ""}`);
  return [
    { type: "function", name: "spawn_agent", strict: false,
      description: [
        "Starts a new agent on a task. Its task name is added below yours: if you are `/root/task1` and name the task `task_3`, the agent is `/root/task1/task_3`, which you can call `task_3` or by its full path; other agents must use the full path.",
        "The agent has the same tools as you, including starting its own agents. It can message you and the other running agents, and its final answer is delivered to you when it finishes. It is told its task name along with your message.",
        "fork_turns decides how much of this conversation it sees: `all` (the default) shares everything so far, `none` shares nothing (so put all the context it needs in the message), and a number shares that many of the most recent turns.",
        "Spawned agents use your model and reasoning effort. Omit `model` and `reasoning_effort` to keep them; set them only when a different model is explicitly needed.",
        ...(overrides.length ? ["Models an agent may be given instead (optional; your own is preferred):", ...overrides] : []),
      ].join("\n"),
      parameters: object({
        task_name: string("Task name for the new agent. Use lowercase letters, digits, and underscores."),
        message: string("The new agent's task, in plain text."),
        fork_turns: string("How many turns of this conversation to share: `none`, `all`, or a positive integer such as `3`. Defaults to `all`."),
        model: string("A different model for the new agent. Omit unless one is explicitly needed."),
        reasoning_effort: string("A different reasoning effort for the new agent. Omit to use yours."),
      }, ["task_name", "message"]) },
    { type: "function", name: "send_message", strict: false,
      description: "Sends a message to an existing agent. It is delivered promptly while the agent works; it does not start a run of an idle agent.",
      parameters: object({ target: string("The agent's task name or full path (from spawn_agent)."), message: string("The message to queue for the agent.") }, ["target", "message"]) },
    { type: "function", name: "followup_task", strict: false,
      description: "Gives an existing agent other than `/root` a new task. An idle agent starts a run with it; a running agent receives it at its next step.",
      parameters: object({ target: string("The agent's task name or full path (from spawn_agent)."), message: string("The new task for the agent.") }, ["target", "message"]) },
    { type: "function", name: "wait_agent", strict: false,
      description: "Waits for news from any agent of your team: a message, or an agent finishing. Also ends early when the user sends new input. It does not return the news itself, which arrives as messages; it returns whether the wait completed, was interrupted, or timed out.",
      parameters: object({ timeout_ms: { type: "number", description: `Timeout in milliseconds. Defaults to ${WAIT.defaultMs}, min ${WAIT.minMs}, max ${WAIT.maxMs}.` } }, []) },
    { type: "function", name: "interrupt_agent", strict: false,
      description: "Stops an agent's current run, if any, and returns its previous status. The agent stays available for messages and follow-up tasks.",
      parameters: object({ target: string("The agent's task name or full path (from spawn_agent).") }, ["target"]) },
    { type: "function", name: "list_agents", strict: false,
      description: "Lists the agents of your team and their status. Optionally only those under a path.",
      parameters: object({ path_prefix: string("Only agents under this path, without a trailing slash. Omit to list all.") }, []) },
  ];
}

export class ToolArgumentError extends Error {}
const fail = (message: string): never => { throw new ToolArgumentError(message); };
function parse(raw: string, allowed: readonly string[]) {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail("Arguments must be a JSON object."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("Arguments must be a JSON object.");
  const args = value as Record<string, unknown>;
  for (const name of Object.keys(args)) if (!allowed.includes(name)) fail(`Unknown argument \`${name}\`.`);
  return args;
}
const text = (args: Record<string, unknown>, name: string, required: boolean) => {
  const value = args[name];
  if (value === undefined || value === null) return required ? fail(`\`${name}\` is required.`) : undefined;
  return typeof value === "string" ? value : fail(`\`${name}\` must be a string.`);
};
export type SpawnArgs = { taskName: string; message: string; forkTurns: "all" | "none" | number; model?: string; effort?: string };
export function spawnArgs(raw: string): SpawnArgs {
  const args = parse(raw, ["task_name", "message", "fork_turns", "model", "reasoning_effort", "fork_context"]);
  if ("fork_context" in args) fail("fork_context is not supported; use fork_turns instead");
  const fork = text(args, "fork_turns", false) ?? "all";
  const forkTurns = fork === "all" || fork === "none" ? fork : /^[1-9]\d{0,5}$/.test(fork) ? Number(fork) : fail("fork_turns must be `none`, `all`, or a positive integer string");
  const message = text(args, "message", true)!;
  if (!message.trim()) fail("Empty message can't be sent to an agent");
  const model = text(args, "model", false), effort = text(args, "reasoning_effort", false);
  return { taskName: text(args, "task_name", true)!, message, forkTurns, ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
}
export function targetArgs(raw: string, withMessage: boolean) {
  const args = parse(raw, withMessage ? ["target", "message"] : ["target"]);
  const target = text(args, "target", true)!;
  if (!target.trim()) fail("`target` is required.");
  if (!withMessage) return { target };
  const message = text(args, "message", true)!;
  if (!message.trim()) fail("Empty message can't be sent to an agent");
  return { target, message };
}
export function waitArgs(raw: string) {
  const args = parse(raw, ["timeout_ms"]);
  const value = args.timeout_ms;
  if (value === undefined || value === null) return { timeoutMs: WAIT.defaultMs, clamped: false };
  if (typeof value !== "number" || !Number.isFinite(value)) return fail("timeout_ms must be a number");
  if (value > WAIT.maxMs) return fail(`timeout_ms must be at most ${WAIT.maxMs}`);
  return value < WAIT.minMs ? { timeoutMs: WAIT.minMs, clamped: true, requested: Math.round(value) } : { timeoutMs: Math.round(value), clamped: false };
}
export function listArgs(raw: string) {
  const args = parse(raw, ["path_prefix"]);
  return { prefix: text(args, "path_prefix", false)?.replace(/\/+$/, "") || null };
}
