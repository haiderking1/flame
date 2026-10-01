import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkStep } from "@contracts/work";
import { ToolRow } from "./ToolRow";
import { MeasuredList } from "../../virtual/MeasuredList";
import { useHistoryContainer } from "../../virtual/HistoryScrollContext";

type ToolStep = Extract<WorkStep, { kind: "tool" }>;
export function ToolGroup({ steps, jobs, location, turnId }: {
  steps: readonly ToolStep[]; jobs: readonly BashJob[]; location: SessionLocation; turnId: string;
}) {
  const scroll = useHistoryContainer();
  const render = (step: ToolStep) => <ToolRow step={step} location={location} job={jobs.find(job => (job.turnId === turnId && job.callId === step.callId) || job.id === step.jobId)} />;
  return <div className="work-tools">{scroll ? <MeasuredList items={steps} itemKey={step => step.id} render={render} scroll={scroll} threshold={40} estimate={32} /> : steps.map(step => <div key={step.id}>{render(step)}</div>)}</div>;
}
