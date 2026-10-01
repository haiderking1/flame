import { useId } from "react";
import type { WorkStep } from "@contracts/work";
import { useToolDisclosure } from "../sessions/work/ToolDisclosure";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";

/** A collaboration tool call in the conversation: a message, a follow-up task, a wait, an interrupt or a listing. */
export function AgentToolRow({ step }: { step: Extract<WorkStep, { kind: "tool" }> }) {
  const [open, setOpen] = useToolDisclosure(step.id);
  const detailId = useId();
  const detail = step.agent?.text ?? null;
  return <div className="work-tool agent-tool" data-failed={!!step.error}>
    <div className="work-tool__row">
      <button className="work-tool__toggle" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen(!open)}>
        <span className="work-chevron" data-open={open} aria-hidden="true">›</span>
        <WorkspaceIcon name="bot" className="work-tool__icon" />
        <span className="work-tool__command" title={step.command}>{step.command}</span>
        <span className="work-tool__status">{step.error ? "Issue" : ""}</span>
      </button>
    </div>
    {open && <div id={detailId} className="work-tool__detail">
      {detail && <pre className="work-tool__output flame-scrollbar">{detail}</pre>}
      {step.error && <p>{step.error}</p>}
      {!detail && !step.error && <p>No details for this step.</p>}
    </div>}
  </div>;
}
