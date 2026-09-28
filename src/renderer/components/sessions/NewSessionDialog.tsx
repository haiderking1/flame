import { useEffect, useId, useRef, useState } from "react";
import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { projectsAtom, resultMessage } from "../../backend/projects";
import { ProjectIcon } from "../projects/ProjectIcon";
import { useSessions } from "./SessionContext";
import "./new-session-dialog.css";

export function NewSessionDialog({ scope, onClose, onCreated, onNewProject }: {
  scope: string | null; onClose(): void; onCreated(projectId: string): void; onNewProject(): void;
}) {
  const sessions = useSessions()!;
  const result = useAtomValue(projectsAtom);
  const retry = useAtomRefresh(projectsAtom);
  const projects = AsyncResult.isSuccess(result) ? result.value : [];
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(scope ?? sessions.document?.projectId ?? null);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const id = useId();
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = projects.filter(project => tokens.every(token => `${project.name} ${project.path}`.toLocaleLowerCase().includes(token)));
  const index = Math.max(0, matches.findIndex(project => project.id === highlighted));
  const busy = sessions.busy;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal(); input.current?.focus();
    return () => {
      element.close();
      requestAnimationFrame(() => {
        if (!document.querySelector('dialog[open], [popover]:popover-open')) document.querySelector<HTMLTextAreaElement>('.workspace textarea')?.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index, query]);
  async function choose(projectId: string) {
    if (busy || submitting.current) return;
    submitting.current = true;
    try { await sessions.newSession(projectId); onCreated(projectId); }
    catch { /* The workspace exposes the error without losing the selection. */ }
    finally { submitting.current = false; }
  }
  return <dialog ref={dialog} className="new-session-dialog" aria-label="New session" aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onPointerDown={event => {
      const box = event.currentTarget.getBoundingClientRect();
      if (!busy && event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) onClose();
    }}>
    <div className="new-session-dialog__search">
      <button type="button" aria-label="Back" disabled={busy} onClick={onClose}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M5 12h14" /></svg>
      </button>
      <input ref={input} role="combobox" aria-label="Search projects for a new session" aria-expanded="true" aria-autocomplete="list"
        aria-controls={`${id}-list`} aria-activedescendant={matches.length ? `${id}-${matches[index]!.id}` : undefined}
        placeholder="Search..." value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setHighlighted(null); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
            event.preventDefault(); setHighlighted(matches[(index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length]!.id);
          } else if (event.key === "Enter") {
            event.preventDefault(); if (matches[index]) void choose(matches[index]!.id);
          }
        }} />
    </div>
    <div className="new-session-dialog__results flame-scrollbar">
      {!!matches.length && <div className="new-session-dialog__label" id={`${id}-label`}>Projects</div>}
      <div id={`${id}-list`} role="listbox" aria-label="Projects">
        {matches.map((project, position) => <div key={project.id} id={`${id}-${project.id}`} role="option" aria-selected={index === position}
          aria-disabled={busy} className="new-session-dialog__project" onPointerMove={() => { if (!busy) setHighlighted(project.id); }}
          onMouseDown={event => event.preventDefault()} onClick={() => { void choose(project.id); }}>
          <ProjectIcon project={project} />
          <div className="new-session-dialog__details"><span>{project.name}</span><small title={project.path}><span>Local</span><span aria-hidden="true">·</span><span>{project.path}</span></small></div>
        </div>)}
      </div>
      {AsyncResult.isInitial(result) && <p className="new-session-dialog__status" role="status">Loading projects…</p>}
      {AsyncResult.isFailure(result) && <p className="new-session-dialog__status" role="alert">{resultMessage(result)} <button type="button" onClick={retry}>Retry</button></p>}
      {AsyncResult.isSuccess(result) && !matches.length && <p className="new-session-dialog__status" role="status">{projects.length ? "No matching projects." : <>No projects yet. <button type="button" onClick={onNewProject}>Add a project</button></>}</p>}
      {sessions.error && <p className="new-session-dialog__error" role="alert">{sessions.error}</p>}
    </div>
    <div className="new-session-dialog__footer" aria-hidden="true">
      <span><kbd><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7M12 19V5" /></svg></kbd><kbd><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 12-7 7-7-7M12 5v14" /></svg></kbd>Navigate</span><span><kbd>Enter</kbd>Select</span><span><kbd>Esc</kbd>Close</span>
    </div>
  </dialog>;
}
