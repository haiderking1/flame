import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkStep } from "@contracts/work";
import { ToolRow } from "./ToolRow";

type ToolStep = Extract<WorkStep, { kind: "tool" }>;
export function ToolGroup({ steps, jobs, location, turnId }: {
  steps: readonly ToolStep[]; jobs: readonly BashJob[]; location: SessionLocation; turnId: string;
}) {
  return <div className="work-tools">
    {steps.map(step => <ToolRow key={step.id} step={step} location={location}
      job={jobs.find(job => (job.turnId === turnId && job.callId === step.callId) || job.id === step.jobId)} />)}
  </div>;
}
