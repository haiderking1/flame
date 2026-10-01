import type { AgentSummary } from "@contracts/agents";
import { activityLine, formatElapsed, formatTokens, isWorking, modelLabel, roleOf, statusLabel, toneOf } from "./agentLabels";

/** T3 Code's agent row: status, name and role, elapsed time; latest activity; model, effort and tokens. Opens its transcript. */
export function AgentRow({ agent, now, onOpen }: { agent: AgentSummary; now: number; onOpen(): void }) {
  const working = isWorking(agent), role = roleOf(agent.path);
  const elapsed = agent.startedAt === null ? null : formatElapsed((working ? now : agent.finishedAt ?? now) - agent.startedAt);
  return <li className="agent-row" data-agent-tone={toneOf(agent.status)}>
    <button type="button" className="agent-row__open" onClick={onOpen} aria-label={`${agent.nickname}, ${statusLabel(agent.status)}. Open transcript`}>
      <span className="agent-row__line">
        <span className="agent-row__dot" aria-hidden="true" />
        <span className="agent-row__name">{agent.nickname}</span>
        {role !== agent.nickname && <span className="agent-row__role" title={agent.path}>{role}</span>}
        {elapsed && <span className="agent-row__time">{agent.status === "completed" ? "✓ " : ""}{elapsed}</span>}
      </span>
      <span className="agent-row__activity" title={activityLine(agent)}>{activityLine(agent)}</span>
      <span className="agent-row__meta">{modelLabel(agent)} · {formatTokens(agent.tokens)}{agent.runs > 1 ? ` · run ${agent.runs}` : ""}</span>
    </button>
  </li>;
}
