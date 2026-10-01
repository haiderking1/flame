import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkActivity, WorkStep } from "@contracts/work";
import { Markdown } from "../../markdown/Markdown";
import { ThinkingLabel } from "./ThinkingLabel";
import { isRunning } from "./ToolRow";
import { ToolGroup } from "./ToolGroup";
import "./work-group.css";
import { lazy, Suspense, useMemo, useRef } from "react";
import { MeasuredList } from "../../virtual/MeasuredList";
import { useHistoryContainer } from "../../virtual/HistoryScrollContext";
import { shareSteps } from "./rowSharing";

// Only threads that start agents show them, so their row loads then rather than at startup.
const AgentSpawnRow = lazy(() => import("../../agents/AgentSpawnRow").then(module => ({ default: module.AgentSpawnRow })));
type ToolStep = Extract<WorkStep, { kind: "tool" }>;
type Block = Extract<WorkStep, { kind: "message" }> | { kind: "tools"; id: string; steps: ToolStep[] } | { kind: "agents"; id: string; steps: ToolStep[] };
function blocks(steps: readonly WorkStep[]): Block[] {
  const result: Block[] = [];
  // Every agent a run started shows as one row, where it started the first.
  let agents: Extract<Block, { kind: "agents" }> | null = null;
  for (const step of steps) {
    const previous = result.at(-1);
    if (step.kind === "tool" && step.agent?.action === "spawn") {
      if (agents) agents.steps.push(step);
      else { agents = { kind: "agents", id: `agents-${step.id}`, steps: [step] }; result.push(agents); }
    }
    else if (step.kind === "message") result.push(step);
    else if (previous?.kind === "tools") previous.steps.push(step);
    else result.push({ kind: "tools", id: step.id, steps: [step] });
  }
  return result;
}
export function WorkGroup({ activity, running, compacting = false, jobs, location, status }: {
  activity: WorkActivity; running: boolean; compacting?: boolean; jobs: readonly BashJob[]; location: SessionLocation; status?: string;
}) {
  const active = jobs.some(job => job.turnId === activity.turnId && isRunning(job));
  const scroll = useHistoryContainer();
  const previous = useRef<readonly WorkStep[]>([]);
  const steps = shareSteps(previous.current, activity.steps); previous.current = steps;
  const items = useMemo(() => blocks(steps), [steps]);
  const render = (block: Block) => block.kind === "message"
    ? <Markdown className="work-group__commentary" text={block.text} streaming={running} />
    : block.kind === "agents" ? <Suspense fallback={null}><AgentSpawnRow id={block.id} steps={block.steps} location={location} /></Suspense>
    : <ToolGroup steps={block.steps} turnId={activity.turnId} jobs={jobs} location={location} />;
  return <section className="work-group" data-running={running || active} aria-label="Agent work">
    <div className="work-group__steps">
      {scroll ? <MeasuredList items={items} itemKey={block => block.id} render={render} scroll={scroll} threshold={40} estimate={64} /> : items.map(block => <div key={block.id}>{render(block)}</div>)}
    </div>
    {running && !active && <p className="turn-status" role="status"><ThinkingLabel>{compacting ? "Compacting conversation" : "Thinking"}</ThinkingLabel></p>}
    {!running && status && status !== "completed" && <p className="turn-status">{status === "cancelled" ? "Work stopped" : status === "failed" ? "Work failed" : "Work interrupted"}</p>}
  </section>;
}
