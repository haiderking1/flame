import { useEffect, useState } from "react";
import type { SessionSummary } from "@contracts/sessions";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Project } from "@contracts/projects";
import { sessionsAtom } from "../../backend/sessions";
import { SessionRow } from "./SessionRow";
import { SettledSection } from "./SettledSection";
import { DeleteSessionDialog } from "./DeleteSessionDialog";
import "./session-list.css";

export function SessionList({ projects, scope, search, onOpened }: { projects: readonly Project[]; scope: string | null; search: string; onOpened(): void }) {
  const result = useAtomValue(sessionsAtom);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!AsyncResult.isSuccess(result)) return <div className="sidebar-threads__empty" role="status">{AsyncResult.isInitial(result) ? "Loading sessions…" : "Session storage unavailable. Reconnecting…"}</div>;
  const tokens = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const sessions = result.value.sessions.filter((session) => (!scope || session.projectId === scope)
    && tokens.every((token) => `${session.title} ${projects.find((project) => project.id === session.projectId)?.name ?? ""}`.toLowerCase().includes(token)));
  const project = projects.find((project) => project.id === scope);
  const settled = sessions.filter(session => session.settledAt !== null).sort((a, b) => b.settledAt! - a.settledAt! || a.sessionId.localeCompare(b.sessionId));
  const row = (session: SessionSummary) => <SessionRow key={`${session.projectId}:${session.sessionId}`} session={session} now={now}
    project={projects.find(project => project.id === session.projectId)} onOpened={onOpened} onDelete={setDeleting} />;
  return <div className="session-list flame-scrollbar">
    {result.value.warnings.map((warning, index) => <p key={index} className="session-list__warning" role="alert">{warning}</p>)}
    {!sessions.length && <div className="sidebar-threads__empty" role="status">{tokens.length ? "No matching sessions" : project ? `No threads in ${project.name} yet` : "No threads yet"}</div>}
    {sessions.filter(session => session.settledAt === null).map(row)}
    <SettledSection count={settled.length} searching={tokens.length > 0}>{settled.map(row)}</SettledSection>
    {deleting && <DeleteSessionDialog session={deleting} onClose={() => setDeleting(null)} />}
  </div>;
}
