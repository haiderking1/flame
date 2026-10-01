import type { AgentStatus, AgentSummary } from "@contracts/agents";

/** T3 Code's agent statuses: working while it runs, idle and resumable once it answered, failed, or stopped. */
export function statusLabel(status: AgentStatus) {
  switch (status) {
    case "pending": case "running": return "Working";
    case "completed": return "Idle · resumable";
    case "errored": return "Failed";
    case "interrupted": return "Stopped";
  }
}
export type AgentTone = "working" | "idle" | "failed" | "stopped";
export const toneOf = (status: AgentStatus): AgentTone =>
  status === "pending" || status === "running" ? "working" : status === "completed" ? "idle" : status === "errored" ? "failed" : "stopped";
export const isWorking = (agent: Pick<AgentSummary, "status">) => agent.status === "pending" || agent.status === "running";
/** The last part of an agent's path, its role in the team: `/root/review_api` is "review_api". */
export const roleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** Token counts as T3 Code writes them: 950, 12.3k, 1.2M. */
export function formatTokens(tokens: number | null) {
  if (tokens === null) return "— tok";
  if (tokens < 1000) return `${tokens} tok`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0).replace(/\.0$/, "")}k tok`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M tok`;
}
/** Elapsed time: 42s, 3m 05s, 1h 02m. */
export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
export const modelLabel = (agent: Pick<AgentSummary, "settings">) =>
  agent.settings ? [agent.settings.modelId, agent.settings.effort].filter(Boolean).join(" · ") : "Model unavailable";
/** The line under an agent's name: its latest activity while it works; once settled, its error or answer. */
export function activityLine(agent: Pick<AgentSummary, "status" | "activity" | "result">) {
  const first = (text: string | null) => text?.split("\n").find(line => line.trim())?.trim() ?? null;
  return isWorking(agent) ? agent.activity ?? statusLabel(agent.status) : first(agent.result) ?? agent.activity ?? statusLabel(agent.status);
}
/** The chat row for a run's spawned agents: "Kicked off 3 subagents" while any works, "Ran 3 subagents" after. */
export function spawnSummary(count: number, live: boolean) {
  return `${live ? "Kicked off" : "Ran"} ${count} subagent${count === 1 ? "" : "s"}`;
}
/** The agent's first task as sent, without the envelope agents' messages carry. */
export function messagePayload(text: string) {
  const match = /^Message Type: [A-Z_]+\nTask name: [^\n]*\nSender: [^\n]*\nPayload:\n/.exec(text);
  return match ? { payload: text.slice(match[0].length), sender: /\nSender: ([^\n]*)\n/.exec(match[0])![1]! } : null;
}
