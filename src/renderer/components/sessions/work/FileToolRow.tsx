import { useId, useState } from "react";
import type { WorkStep, FileWorkDetail } from "@contracts/work";
import { ThinkingLabel } from "./ThinkingLabel";

const labels: Record<FileWorkDetail["status"], string> = { pending: "Pending", completed: "Done", failed: "Failed", uncertain: "Uncertain", deferred: "Not run" };
export function FileToolRow({ step, detail }: { step: Extract<WorkStep, { kind: "tool" }>; detail: FileWorkDetail }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return <div className="work-tool" data-state={detail.status} data-failed={detail.status === "failed" || detail.status === "uncertain"}>
    <div className="work-tool__row">
      <button className="work-tool__toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
        <span className="work-chevron" data-open={open} aria-hidden="true">›</span>
        <span className="work-tool__command" title={step.command}>{step.command}</span>
        <span className="work-tool__status">{detail.status === "pending" ? <ThinkingLabel>{labels[detail.status]}</ThinkingLabel> : labels[detail.status]}</span>
      </button>
    </div>
    {open && <div id={detailId} className="work-tool__detail">
      <p>{detail.summary}</p>
      {detail.output && <pre className="work-tool__output flame-scrollbar">{detail.output}</pre>}
      {detail.truncated && <p>Showing a bounded preview of the tool result.</p>}
      {step.error && <p>{step.error}</p>}
    </div>}
  </div>;
}
