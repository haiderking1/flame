import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { Project } from "@contracts/projects";
import { sessionsAtom } from "../../backend/sessions";
import { useSessions } from "./SessionContext";
import "./session-list.css";

export function SessionList({ projects, scope, search, onOpened }: { projects: readonly Project[]; scope: string | null; search: string; onOpened(): void }) {
  const result = useAtomValue(sessionsAtom);
  const workspace = useSessions()!;
  if (!AsyncResult.isSuccess(result)) return <div className="sidebar-threads__empty" role="status">{AsyncResult.isInitial(result) ? "Loading sessions…" : "Session storage unavailable. Reconnecting…"}</div>;
  const tokens = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const sessions = result.value.sessions.filter((session) => (!scope || session.projectId === scope)
    && tokens.every((token) => `${session.title} ${projects.find((project) => project.id === session.projectId)?.name ?? ""}`.toLowerCase().includes(token)));
  const project = projects.find((project) => project.id === scope);
  return <div className="session-list flame-scrollbar">
    {result.value.warnings.map((warning, index) => <p key={index} className="session-list__warning" role="alert">{warning}</p>)}
    {!sessions.length && <div className="sidebar-threads__empty" role="status">{tokens.length ? "No matching sessions" : project ? `No threads in ${project.name} yet` : "No threads yet"}</div>}
    {sessions.map((session) => <button key={`${session.projectId}:${session.sessionId}`} type="button" className="session-list__item"
      aria-current={workspace.document?.sessionId === session.sessionId && workspace.document?.projectId === session.projectId ? "page" : undefined}
      disabled={workspace.busy} onClick={() => { void workspace.open(session).then(onOpened, () => {}); }}>
      <span className="session-list__title">{session.title}</span>
      <span className="session-list__detail">{projects.find((project) => project.id === session.projectId)?.name ?? "Project"}
        <time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
      </span>
    </button>)}
  </div>;
}
