import "./agents-inline.css";
import { useId } from "react";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkStep } from "@contracts/work";
import { useToolDisclosure } from "../sessions/work/ToolDisclosure";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";
import { formatElapsed, formatTokens, isWorking, roleOf, spawnSummary, statusLabel, toneOf } from "./agentLabels";
import { AgentToolRow } from "./AgentToolRow";
import { rightPanel } from "./rightPanel";
import { useAgentThread, useThreadAgents } from "./useThreadAgents";

type ToolStep = Extract<WorkStep, { kind: "tool" }>;
/**
 * T3 Code's spawn row: every agent a run started, as one row, "Kicked off 3 subagents" while any works and "Ran 3
 * subagents" after; it opens to the agents, each opening its transcript. Spawns that failed stay visible as their own rows.
 */
export function AgentSpawnRow({ id, steps, location }: { id: string; steps: readonly ToolStep[]; location: SessionLocation }) {
  const [open, setOpen] = useToolDisclosure(id);
  const detailId = useId();
  const agents = useThreadAgents(useAgentThread(location));
  const started = steps.filter(step => !step.error), failed = steps.filter(step => step.error);
  const members = started.map(step => ({ step, agent: agents.find(agent => agent.path === step.agent?.target) ?? null }));
  const live = members.some(member => !member.agent || isWorking(member.agent));
  const tone = members.some(member => member.agent?.status === "errored") ? "failed" : live ? "working" : "idle";
  return <>
    {started.length > 0 && <div className="work-tool agent-spawn" data-agent-tone={tone}>
      <div className="work-tool__row">
        <button className="work-tool__toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
          <span className="work-chevron" data-open={open} aria-hidden="true">›</span>
          <WorkspaceIcon name="bot" className="work-tool__icon" />
          <span className="work-tool__command agent-spawn__label">{spawnSummary(started.length, live)}</span>
        </button>
      </div>
      {open && <div id={detailId} className="work-tool__detail agent-spawn__detail">
        <ul className="agent-spawn__members">
          {members.map(({ step, agent }) => <li key={step.id} data-agent-tone={agent ? toneOf(agent.status) : "working"}>
            <button type="button" disabled={!agent} onClick={() => agent && rightPanel.open("agents", agent.sessionId)}>
              <span className="agent-row__dot" aria-hidden="true" />
              <span className="agent-spawn__name">{agent?.nickname ?? step.agent?.target ?? "Agent"}</span>
              <span className="agent-row__role">{roleOf(step.agent?.target ?? "")}</span>
              <span className="agent-spawn__status">{!agent || isWorking(agent) ? "Working"
                : agent.startedAt !== null && agent.finishedAt !== null ? `${formatElapsed(agent.finishedAt - agent.startedAt)} · ${formatTokens(agent.tokens)}` : statusLabel(agent.status)}</span>
            </button>
            {step.agent?.text && <p className="agent-spawn__task">{step.agent.text}</p>}
          </li>)}
        </ul>
        <button type="button" className="agent-spawn__panel" onClick={() => rightPanel.open("agents")}>Open Agents panel ›</button>
      </div>}
    </div>}
    {failed.map(step => <AgentToolRow key={step.id} step={step} />)}
  </>;
}
