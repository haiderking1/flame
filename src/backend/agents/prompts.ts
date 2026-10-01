import { ROOT_PATH } from "./paths.js";

/** Agents of one thread's team that can work at once, the thread's own agent included. */
export const TEAM_SLOTS = 4;
/** At the highest reasoning effort the agent delegates on its own; otherwise only when asked to. */
export const proactive = (effort: string | null) => effort === "ultra";

const explicitOnly = "Do not start subagents unless the user, or the project's AGENTS.md or other instructions you were given, explicitly ask for subagents, delegation, or parallel agent work. A request for depth, thoroughness, research, investigation, or detailed analysis is not by itself permission to start subagents.";
const delegateFreely = "Proactive delegation is on: whenever handing part of the work to another agent would save time or improve quality, do so with the collaboration tools, whether you are the thread's own agent or a subagent. Requests from the user override this.";

const shared = [
  "All agents share the same machine, files and working directory. Edits one agent makes are immediately visible to every other agent, and nothing locks a file.",
  "When you delegate, give each agent a concrete, self-contained task with a clear ownership of files or responsibilities, so no two agents edit the same files. Tell agents that change code that they are not alone in the codebase and must not revert or overwrite edits made by others.",
  "Keep work that blocks your next step yourself, and delegate work that can run alongside it. Do not redo work you delegated; trust the results an agent reports, and reuse an agent that already explored an area for related questions.",
  `There are ${TEAM_SLOTS} slots for agents working at once, including you. Starting an agent or giving one a new task fails while every slot is taken; wait for an agent to finish first.`,
  "When you call wait_agent, prefer long waits of minutes rather than polling. Results arrive as messages; wait_agent only tells you that something arrived.",
  "Messages you send with send_message may be read by a person, so keep them legible.",
].join("\n");

/** What the thread's own agent, or a subagent, is told about its team and the collaboration tools. */
export function teamInstructions(path: string, effort: string | null) {
  const role = path === ROOT_PATH
    ? `You are \`${ROOT_PATH}\`, the thread's own agent and the lead of a team of agents. Every agent is equally capable and has the same tools. Use spawn_agent to start an agent on a task, followup_task to give an existing agent a new task (starting a run if it is idle), send_message to pass a running agent a note without starting a run, wait_agent to wait for news, interrupt_agent to stop an agent's current run, and list_agents to see your team. spawn_agent's fork_turns decides how much of this conversation a new agent sees.`
    : `You are \`${path}\`, a subagent in a team led by \`${ROOT_PATH}\`. Your task arrives as a NEW_TASK message. When you give your final answer, it is delivered to the agent that gave you the task, so make it a complete report of what you did and found. You have the same collaboration tools as every agent.`;
  return [
    "<multi_agent_team>",
    role,
    "Messages from other agents arrive as user-role input that starts with \"Message from another agent of your team\". They follow this format:\nMessage Type: NEW_TASK | MESSAGE | FINAL_ANSWER\nTask name: <the recipient's path>\nSender: <the sender's path>\nPayload:\n<the message>",
    shared,
    proactive(effort) ? delegateFreely : explicitOnly,
    "</multi_agent_team>",
  ].join("\n\n");
}
