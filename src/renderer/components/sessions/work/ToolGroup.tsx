import { useId, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkStep } from "@contracts/work";
import { stopBash } from "../../../backend/bash";
import { ThinkingLabel } from "./ThinkingLabel";
import { isFailure, isRunning, ToolRow } from "./ToolRow";

type ToolStep = Extract<WorkStep, { kind: "tool" }>;
export function ToolGroup({ steps, jobs, location, turnId, working }: {
  steps: readonly ToolStep[]; jobs: readonly BashJob[]; location: SessionLocation; turnId: string; working: boolean;
}) {
  const [open, setOpen] = useState(false), [stopping, setStopping] = useState(false), [error, setError] = useState<string>();
  const id = useId(), stop = useAtomSet(stopBash, { mode: "promise" });
  const jobFor = (step: ToolStep) => jobs.find(job => (job.turnId === turnId && job.callId === step.callId) || job.id === step.jobId);
  const linked = [...new Map(steps.flatMap(step => { const job = jobFor(step); return job ? [[job.id, job] as const] : []; })).values()];
  const active = linked.filter(isRunning);
  const failed = steps.some(step => { const job = jobFor(step); return job ? isFailure(job) : !!step.error; });
  const cancelled = linked.some(job => job.status === "cancelled");
  const shell = steps.some(step => step.name === "bash");
  const unconfirmed = steps.some(step => !jobFor(step) && !step.jobId && !step.error);
  const label = active.length ? "Running command" : unconfirmed ? (working ? "Preparing command" : "Command not confirmed") : failed ? "Command needs attention" : cancelled ? "Command stopped"
    : shell ? (steps.length === 1 ? "Ran command" : "Ran commands") : "Checked background job";
  const hint = (active[0]?.command ?? steps.at(-1)?.command ?? "").split(/\r?\n/).find(line => line.trim()) ?? "";
  async function cancel() {
    setStopping(true); setError(undefined);
    const results = await Promise.allSettled(active.map(job => stop({ ...location, jobId: job.id })));
    if (results.some(result => result.status === "rejected")) setError("Could not stop every command. Expand to check their actual status.");
    setStopping(false);
  }
  return <div className="work-tools" data-running={active.length > 0}>
    <div className="work-group__summary">
      <button className="work-group__heading" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <ThinkingLabel active={active.length > 0}>{label}</ThinkingLabel>
        <span className="work-group__hint" title={hint}>{hint}</span>
        <span className="work-chevron" data-open={open} aria-hidden="true">›</span>
      </button>
      {active.length > 0 && !open && <button className="work-tool__stop" disabled={stopping} onClick={() => void cancel()} aria-label="Stop running commands">{stopping ? "Stopping…" : "Stop"}</button>}
    </div>
    {error && <p className="work-tool__error" role="alert">{error}</p>}
    {open && <div id={id} className="work-group__body flame-scrollbar">
      {steps.map(step => <ToolRow key={step.id} step={step} job={jobFor(step)} location={location} />)}
    </div>}
  </div>;
}
