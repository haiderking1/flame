import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom, resultMessage } from "../../backend/projects";
import "./sidebar-threads.css";

export function SidebarThreads({ scope, onNewProject }: { scope: string | null; onNewProject(): void }) {
  const result = useAtomValue(projectsAtom);
  const retry = useAtomRefresh(projectsAtom);
  if (AsyncResult.isInitial(result)) return <div className="sidebar-threads__empty" role="status">Loading projects…</div>;
  if (!AsyncResult.isSuccess(result)) return <div className="sidebar-threads__empty" role="alert">{resultMessage(result)}<button type="button" onClick={retry}>Retry</button></div>;
  const project = result.value.find((item) => item.id === scope);
  return <div className="sidebar-threads__empty" role="status">
    {result.value.length === 0 ? <>
      <span>No projects yet</span>
      <button type="button" onClick={onNewProject}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add project
      </button>
    </> : project ? `No threads in ${project.name} yet` : "No threads yet"}
  </div>;
}
