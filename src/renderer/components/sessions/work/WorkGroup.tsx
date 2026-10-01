import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkActivity, WorkStep } from "@contracts/work";
import { Markdown } from "../../markdown/Markdown";
import { ThinkingLabel } from "./ThinkingLabel";
import { isRunning } from "./ToolRow";
import { ToolGroup } from "./ToolGroup";
import "./work-group.css";
import { useMemo, useRef } from "react";
import { MeasuredList } from "../../virtual/MeasuredList";
import { useHistoryContainer } from "../../virtual/HistoryScrollContext";
import { shareSteps } from "./rowSharing";

type Block = Extract<WorkStep, { kind: "message" }> | { kind: "tools"; id: string; steps: Extract<WorkStep, { kind: "tool" }>[] };
function blocks(steps: readonly WorkStep[]): Block[] {
  const result: Block[] = [];
  for (const step of steps) {
    const previous = result.at(-1);
    if (step.kind === "message") result.push(step);
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
    : <ToolGroup steps={block.steps} turnId={activity.turnId} jobs={jobs} location={location} />;
  return <section className="work-group" data-running={running || active} aria-label="Agent work">
    <div className="work-group__steps">
      {scroll ? <MeasuredList items={items} itemKey={block => block.id} render={render} scroll={scroll} threshold={40} estimate={64} /> : items.map(block => <div key={block.id}>{render(block)}</div>)}
    </div>
    {running && !active && <p className="turn-status" role="status"><ThinkingLabel>{compacting ? "Compacting conversation" : "Thinking"}</ThinkingLabel></p>}
    {!running && status && status !== "completed" && <p className="turn-status">{status === "cancelled" ? "Work stopped" : status === "failed" ? "Work failed" : "Work interrupted"}</p>}
  </section>;
}
