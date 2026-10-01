import type { AgentWork } from "../../contracts/work.js";
import { isCollaborationTool } from "../agents/tools.js";

const ACTIONS = { spawn_agent: "spawn", send_message: "message", followup_task: "followup", wait_agent: "wait", interrupt_agent: "interrupt", list_agents: "list" } as const;
const text = (value: unknown) => typeof value === "string" ? value : null;
/** How a collaboration tool call reads in the conversation, or null for other tools. */
export function agentWork(name: string, args: Record<string, unknown>, result: Record<string, unknown> | undefined): { command: string; agent: AgentWork } | null {
  if (!isCollaborationTool(name)) return null;
  const action = ACTIONS[name];
  const target = text(result?.task_name) ?? text(args.task_name) ?? text(args.target);
  const agent = { action, target, text: text(args.message) };
  const command = action === "spawn" ? `Started agent ${target ?? ""}`.trim()
    : action === "message" ? `Messaged ${target ?? "an agent"}`
    : action === "followup" ? `Gave ${target ?? "an agent"} a new task`
    : action === "wait" ? result?.timed_out === true ? "Waited for agents (timed out)" : "Waited for agents"
    : action === "interrupt" ? `Interrupted ${target ?? "an agent"}` : "Listed agents";
  return { command, agent };
}
