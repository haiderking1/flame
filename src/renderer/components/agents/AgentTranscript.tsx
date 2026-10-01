import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { AgentSummary } from "@contracts/agents";
import type { SessionPage } from "@contracts/sessions";
import { sessionHistory, sessionErrorMessage } from "../../backend/sessions";
import { SessionTimeline } from "../sessions/work/SessionTimeline";
import { useTurnState } from "../sessions/useTurnState";
import { HistoryScrollContext } from "../virtual/HistoryScrollContext";
import { messagePayload } from "./agentLabels";
import { AgentThreadContext } from "./useThreadAgents";

/** An agent's whole conversation, read-only: its tasks and messages, its work, and its answers, live while it runs. */
export default function AgentTranscript({ agent }: { agent: AgentSummary }) {
  const location = useMemo(() => ({ projectId: agent.projectId, sessionId: agent.sessionId }), [agent.projectId, agent.sessionId]);
  const thread = useMemo(() => ({ projectId: agent.projectId, sessionId: agent.rootSessionId }), [agent.projectId, agent.rootSessionId]);
  const history = useAtomSet(sessionHistory, { mode: "promise" });
  const { turn } = useTurnState(location);
  const [page, setPage] = useState<SessionPage | null>(null), [revision, setRevision] = useState(0), [error, setError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null), following = useRef(true);
  // Reloaded when a run starts or ends; while it runs, the live turn shows its progress.
  const settled = turn && turn.status !== "running" ? turn.revision : -1;
  useEffect(() => {
    let current = true;
    history({ ...location, before: null }).then(next => {
      if (!current) return;
      setPage(next); setError(null);
      if (settled >= 0) setRevision(settled);
    }, failure => { if (current) setError(sessionErrorMessage(failure)); });
    return () => { current = false; };
  }, [location, settled, agent.runs]);
  // Tasks and messages from the team read as what they say, with who sent them.
  const entries = useMemo(() => (page?.entries ?? []).map(entry => {
    if (entry.kind !== "user" || !entry.text) return entry;
    const message = messagePayload(entry.text);
    return message ? { ...entry, text: `From ${message.sender}:\n\n${message.payload}` } : entry;
  }), [page]);
  useEffect(() => {
    const element = scroll.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  });
  return <div ref={scroll} className="agents-panel__transcript flame-scrollbar" role="region" aria-label={`${agent.nickname}'s transcript`}
    onScroll={event => { const element = event.currentTarget; following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48; }}>
    {error && <p className="agents-panel__error" role="alert">{error}</p>}
    {!page && !error && <p className="optional-panel-loading">Loading transcript…</p>}
    {page && <AgentThreadContext value={thread}><HistoryScrollContext value={scroll}>
      <SessionTimeline location={location} entries={entries} compactions={page.compactions} turn={turn} revision={revision} />
    </HistoryScrollContext></AgentThreadContext>}
  </div>;
}
