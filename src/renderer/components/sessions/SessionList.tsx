import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@contracts/sessions";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Project } from "@contracts/projects";
import { sessionsAtom } from "../../backend/sessions";
import { SessionRow } from "./SessionRow";
import { SettledSection } from "./SettledSection";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import "./session-list.css";
import { MeasuredList } from "../virtual/MeasuredList";

export function SessionList({ projects, scope, search, onOpened }: { projects: readonly Project[]; scope: string | null; search: string; onOpened(): void }) {
  const result = useAtomValue(sessionsAtom);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const [now, setNow] = useState(Date.now);
  const query = useDeferredValue(search);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!AsyncResult.isSuccess(result)) return <div className="sidebar-threads__empty" role="status">{AsyncResult.isInitial(result) ? "Loading sessions…" : "Session storage unavailable. Reconnecting…"}</div>;
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const sessions = result.value.sessions.filter((session) => (!scope || session.projectId === scope)
    && tokens.every((token) => `${session.title} ${projects.find((project) => project.id === session.projectId)?.name ?? ""}`.toLowerCase().includes(token)));
  const project = projects.find((project) => project.id === scope);
  const settled = sessions.filter(session => session.settledAt !== null).sort((a, b) => b.settledAt! - a.settledAt! || a.sessionId.localeCompare(b.sessionId));
  const row = (session: SessionSummary) => <SessionRow key={`${session.projectId}:${session.sessionId}`} session={session} now={now}
    project={projects.find(project => project.id === session.projectId)} onOpened={onOpened} onDelete={setDeleting} />;
  return <div ref={scroll} className="session-list flame-scrollbar" aria-busy={query !== search}>
    {result.value.warnings.map((warning, index) => <p key={index} className="session-list__warning" role="alert">{warning}</p>)}
    {!sessions.length && <div className="sidebar-threads__empty" role="status">{tokens.length ? "No matching sessions" : project ? `No threads in ${project.name} yet` : "No threads yet"}</div>}
    <MeasuredList items={sessions.filter(session => session.settledAt === null)} itemKey={session => `${session.projectId}:${session.sessionId}`} render={row} scroll={scroll} estimate={84} />
    <SettledSection count={settled.length} searching={tokens.length > 0}><MeasuredList items={settled} itemKey={session => `${session.projectId}:${session.sessionId}`} render={row} scroll={scroll} estimate={32} /></SettledSection>
    {deleting && <DeleteSessionDialog session={deleting} onClose={() => setDeleting(null)} />}
  </div>;
}
