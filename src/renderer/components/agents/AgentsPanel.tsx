import { lazy, Suspense } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSessions } from "../sessions/SessionContext";
import { DiffSheet } from "../workspace/DiffSheet";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";
import { AgentRow } from "./AgentRow";
import { formatTokens, isWorking } from "./agentLabels";
import { rightPanel, useRightPanel } from "./rightPanel";
import { useNow, useThreadAgents } from "./useThreadAgents";
import "../workspace/diff-panel.css";
import "./agents.css";

// An agent's transcript loads when one is opened.
const AgentTranscript = lazy(() => import("./AgentTranscript"));
/** T3 Code's Agents surface of the right panel: the thread's agents with live status, activity and tokens; each opens its transcript. */
export default function AgentsPanel({ onClose }: { onClose(): void }) {
  const sessions = useSessions(), thread = sessions?.document ? { projectId: sessions.document.projectId, sessionId: sessions.document.sessionId } : null;
  const agents = useThreadAgents(thread), { agent: selectedId } = useRightPanel();
  const selected = agents.find(agent => agent.sessionId === selectedId) ?? null;
  const working = agents.filter(isWorking).length, idle = agents.filter(agent => agent.status === "completed").length;
  const now = useNow(working > 0);
  const overlay = useMediaQuery("(max-width: 980px)");
  const total = agents.reduce((sum, agent) => sum + (agent.tokens ?? 0), 0);
  const content = <aside id="workspace-agents" className="diff-panel agents-panel" aria-labelledby="agents-panel-title">
    <header className="diff-panel__header agents-panel__header">
      {selected ? <>
        <button type="button" className="diff-toolbar__icon" aria-label="Back to agents" title="Back to agents" onClick={() => rightPanel.list()}><WorkspaceIcon name="chevron-left" /></button>
        <h2 id="agents-panel-title">{selected.nickname} <span className="agents-panel__path">{selected.path}</span></h2>
      </> : <h2 id="agents-panel-title">Agents</h2>}
      <button type="button" className="diff-toolbar__icon agents-panel__close" aria-label="Close agents panel" title="Close agents panel" onClick={onClose}><WorkspaceIcon name="close" /></button>
    </header>
    {selected ? <Suspense fallback={<p className="optional-panel-loading">Loading transcript…</p>}><AgentTranscript key={selected.sessionId} agent={selected} /></Suspense>
      : agents.length ? <>
        <ul className="agents-panel__list flame-scrollbar" aria-label="Agents">
          {agents.map(agent => <AgentRow key={agent.sessionId} agent={agent} now={now} onOpen={() => rightPanel.open("agents", agent.sessionId)} />)}
        </ul>
        <footer className="agents-panel__footer">
          {working > 0 && <span className="agents-panel__working">● {working} working</span>}
          {idle > 0 && <span>{idle} idle</span>}
          {agents.length - working - idle > 0 && <span>{agents.length - working - idle} settled</span>}
          <span className="agents-panel__tokens">Σ {formatTokens(total)}</span>
        </footer>
      </> : <div className="agents-panel__empty">
        <WorkspaceIcon name="bot" />
        <p className="agents-panel__empty-title">No agents yet</p>
        <p>When this thread spawns subagents, they show up here with live status, activity, and token usage.</p>
      </div>}
  </aside>;
  return overlay ? <DiffSheet open onClose={onClose}>{content}</DiffSheet> : content;
}
