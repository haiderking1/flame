import "./agents-inline.css";
import type { Ref } from "react";
import { useSessions } from "../sessions/SessionContext";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";
import { isWorking } from "./agentLabels";
import { useThreadAgents } from "./useThreadAgents";

/** Opens the Agents surface; shown once the thread has agents, with how many are working, as T3 Code's panel toggle shows them. */
export function AgentsToggle({ open, onToggle, buttonRef }: { open: boolean; onToggle(): void; buttonRef: Ref<HTMLButtonElement> }) {
  const sessions = useSessions(), document = sessions?.document;
  const agents = useThreadAgents(document ? { projectId: document.projectId, sessionId: document.sessionId } : null);
  if (!agents.length) return null;
  const working = agents.filter(isWorking).length;
  const label = `Toggle agents panel${working ? `, ${working} agent${working === 1 ? "" : "s"} working` : ""}`;
  return <button ref={buttonRef} className="workspace-diff-toggle agents-toggle" type="button" aria-label={label} title={label} aria-expanded={open} aria-controls="workspace-agents" onClick={onToggle}>
    <WorkspaceIcon name="bot" />{working > 0 && !open && <span className="agents-toggle__badge" aria-hidden="true">{working}</span>}
  </button>;
}
