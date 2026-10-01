import { lazy, memo, Suspense, useEffect, useId, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkStep } from "@contracts/work";
import { readBash, stopBash } from "../../../backend/bash";
import { FileToolRow } from "./FileToolRow";
import { ThinkingLabel } from "./ThinkingLabel";
import { useToolDisclosure } from "./ToolDisclosure";

// Collaboration tool rows load with the first thread that uses agents.
const AgentToolRow = lazy(() => import("../../agents/AgentToolRow").then(module => ({ default: module.AgentToolRow })));
export const isRunning = (job: BashJob) => job.status === "running" || job.status === "claimed";
export const isFailure = (job: BashJob) => job.status === "failed" || job.status === "interrupted" || (job.status === "exited" && (job.exitCode !== 0 || !!job.message));
function statusLabel(job?: BashJob) {
  if (!job) return "Details";
  if (job.status === "exited") return job.exitCode === 0 ? (job.message ? "Warning" : "Done") : `exit ${job.exitCode ?? job.signal ?? "unknown"}`;
  return job.status === "claimed" ? "Starting" : job.status;
}
type Props = { step: Extract<WorkStep, { kind: "tool" }>; job?: BashJob; location: SessionLocation };
export const ToolRow = memo(function ToolRow(props: Props) {
  return props.step.file ? <FileToolRow step={props.step} detail={props.step.file} location={props.location} />
    : props.step.agent ? <Suspense fallback={null}><AgentToolRow step={props.step} /></Suspense> : <BashToolRow {...props} />;
});
function BashToolRow({ step, job: live, location }: Props) {
  const detailId = useId();
  const [open, setOpen] = useToolDisclosure(step.id), [saved, setSaved] = useState<BashJob>();
  const [loading, setLoading] = useState(false), [stopping, setStopping] = useState(false), [error, setError] = useState<string>();
  const read = useAtomSet(readBash, { mode: "promise" }), stop = useAtomSet(stopBash, { mode: "promise" });
  const job = live ?? saved;
  async function load() {
    if (job || !step.jobId || loading) return;
    setLoading(true); setError(undefined);
    try { setSaved(await read({ ...location, jobId: step.jobId })); }
    catch { setError("Could not load command output."); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) void load(); }, [open, step.jobId]);
  async function cancel() {
    if (!job) return;
    setStopping(true); setError(undefined);
    try { await stop({ ...location, jobId: job.id }); }
    catch { setError("Could not stop this command. Its actual status is shown here."); }
    finally { setStopping(false); }
  }
  return <div className="work-tool" data-state={job?.status ?? "saved"} data-failed={job ? isFailure(job) : !!step.error}>
    <div className="work-tool__row">
      <button className="work-tool__toggle" aria-expanded={open} aria-controls={detailId} onClick={() => { setOpen(!open); if (!open) void load(); }}>
        <span className="work-chevron" data-open={open} aria-hidden="true">›</span>
        <span className="work-tool__command" title={step.command}>{step.name === "bash" ? "$ " : ""}{step.command}</span>
        <span className="work-tool__status">{job?.background ? "background · " : ""}{job && isRunning(job) ? <ThinkingLabel>{statusLabel(job)}</ThinkingLabel> : step.deferred ? "Not run" : !job && step.error ? "Issue" : statusLabel(job)}</span>
      </button>
      {job && isRunning(job) && <button className="work-tool__stop" disabled={stopping} onClick={() => void cancel()} aria-label={`Stop Bash job ${job.id}`}>{stopping ? "Stopping…" : "Stop"}</button>}
    </div>
    {error && <p className="work-tool__error" role="alert">{error} {!job && <button onClick={() => void load()}>Retry</button>}</p>}
    {open && <div id={detailId} className="work-tool__detail">
      {step.deferred ? <p>{step.deferred}</p> : <pre className="work-tool__output flame-scrollbar">{loading ? "Loading output…" : job?.text || (job && isRunning(job) ? "Waiting for output…" : job ? "No output." : "No saved process output for this step.")}</pre>}
      {job?.truncated && <p>Showing the last 64 KiB. Earlier output was discarded.</p>}
      {(job?.message || (!job && step.error)) && <p>{job?.message ?? step.error}</p>}
      {job && !job.outputClosed && !isRunning(job) && <p>Output collection is incomplete.</p>}
    </div>}
  </div>;
}
