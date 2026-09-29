import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkActivity, WorkStep } from "@contracts/work";
import { Markdown } from "../../markdown/Markdown";
import { ThinkingLabel } from "./ThinkingLabel";
import { isRunning } from "./ToolRow";
import { ToolGroup } from "./ToolGroup";
import "./work-group.css";

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
export function WorkGroup({ activity, running, jobs, location, status }: {
  activity: WorkActivity; running: boolean; jobs: readonly BashJob[]; location: SessionLocation; status?: string;
}) {
  const active = jobs.some(job => job.turnId === activity.turnId && isRunning(job));
  return <section className="work-group" data-running={running || active} aria-label="Agent work">
    <div className="work-group__steps">
      {blocks(activity.steps).map(block => block.kind === "message"
        ? <Markdown className="work-group__commentary" key={block.id} text={block.text} streaming={running} />
        : <ToolGroup key={block.id} steps={block.steps} turnId={activity.turnId} jobs={jobs} location={location} />)}
    </div>
    {running && !active && <p className="turn-status" role="status"><ThinkingLabel>Thinking</ThinkingLabel></p>}
    {!running && status && status !== "completed" && <p className="turn-status">{status === "cancelled" ? "Work stopped" : status === "failed" ? "Work failed" : "Work interrupted"}</p>}
  </section>;
}
