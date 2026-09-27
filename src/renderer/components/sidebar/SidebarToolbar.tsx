import { useRef, type ReactNode } from "react";
import { ProjectFilter } from "../projects/ProjectFilter";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom } from "../../backend/projects";
import "./sidebar-toolbar.css";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function SidebarToolbar({ onNewProject, scope, onScopeChange }: { onNewProject(): void; scope: string | null; onScopeChange(id: string | null): void }) {
  const search = useRef<HTMLLabelElement>(null);
  const projects = useAtomValue(projectsAtom);
  const hasProjects = AsyncResult.isSuccess(projects) && projects.value.length > 0;
  return (
    <div className="sidebar-toolbar" role="group" aria-label="Projects and threads">
      <label ref={search} className="sidebar-toolbar__search" title="Thread search is not connected yet">
        <Icon><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></Icon>
        <input type="search" aria-label="Search threads" placeholder="Search" disabled />
      </label>
      <div className="sidebar-toolbar__actions">
        {hasProjects && <><ProjectFilter scope={scope} onChange={onScopeChange} anchor={search} />
        <button type="button" aria-label="New project" title="New project" onClick={onNewProject}>
          <Icon><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z M9 13h6m-3-3v6" /></Icon>
        </button>
        </>}
        <button type="button" aria-label="New thread" title="New thread is not connected yet" disabled>
          <Icon><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M16 4l4 4 M10 14l1-5 7-7a2.1 2.1 0 0 1 3 3l-7 7Z" /></Icon>
        </button>
      </div>
    </div>
  );
}
