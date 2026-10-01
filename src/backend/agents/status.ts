import type { AgentStatus } from "../../contracts/agents.js";
import type { TurnSnapshot } from "../../contracts/turns.js";

/** An agent's status from its latest run: none yet, running, or how it ended. A stopped run leaves it interrupted. */
export function agentStatus(latest: Pick<TurnSnapshot, "status"> | null): AgentStatus {
  if (!latest) return "pending";
  switch (latest.status) {
    case "running": return "running";
    case "completed": return "completed";
    case "failed": return "errored";
    default: return "interrupted";
  }
}
/** The latest final answer, or why the latest run failed. */
export function agentResult(latest: Pick<TurnSnapshot, "status" | "text" | "message"> | null) {
  if (!latest) return null;
  if (latest.status === "completed") return latest.text || null;
  if (latest.status === "failed") return latest.message ?? "The agent's run failed.";
  return null;
}
/** How a status reads to the model: idle agents keep their final message, as `{"completed": ...}` or `{"errored": ...}`. */
export function modelStatus(status: AgentStatus, result: string | null) {
  if (status === "completed") return { completed: result };
  if (status === "errored") return { errored: result ?? "The agent's run failed." };
  return status === "pending" ? "pending_init" : status;
}
