import { useCallback, useId, useRef, useState, useSyncExternalStore } from "react";
import type { Project } from "@contracts/projects";
import type { SessionSummary } from "@contracts/sessions";
import { sessionErrorMessage } from "../../backend/sessions";
import { toastStore } from "../toasts/toastStore";
import { ProjectIcon } from "../projects/ProjectIcon";
import { useSessions } from "./SessionContext";
import { SessionMenu } from "./SessionMenu";
import openaiLogo from "../../assets/providers/openai.svg?no-inline";
import { sessionTime } from "./sessionTime";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";
import { branchMismatch, folderName, movedWorkspace } from "../composer/workspace/workspaceLogic";
import { gitStatusStore } from "../workspace/git/gitStatusStore";
import { useThreadStatus } from "../notifications/useThreadStatus";
import { Tooltip } from "../tooltip/Tooltip";
import { returnFocus } from "../../lib/returnFocus";

export function SessionRow({ session, project, now, onOpened, onDelete }: {
  now: number; session: SessionSummary; project?: Project; onOpened(): void; onDelete(session: SessionSummary): void;
}) {
  const workspace = useSessions()!;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editValue = useRef<string | null>(null);
  const pending = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const row = useRef<HTMLButtonElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const active = workspace.document?.projectId === session.projectId && workspace.document.sessionId === session.sessionId;
  // Reads the project checkout's cached Git status only; the row never starts a status read of its own.
  const subscribe = useCallback((listener: () => void) => gitStatusStore.subscribe(session.projectId, listener), [session.projectId]);
  const checkout = useSyncExternalStore(subscribe, () => gitStatusStore.snapshot(session.projectId));
  const mismatch = branchMismatch(session.workspace, checkout.status?.branch ?? null);
  const status = useThreadStatus(session);
  const regenerating = session.titleState.regeneration !== null;
  function regenerateTitle() {
    if (regenerating) return;
    void workspace.regenerateTitle(session).catch(error => {
      const text = sessionErrorMessage(error);
      toastStore.show({ id: `title:${session.projectId}:${session.sessionId}`, scope: session.projectId, type: "error", title: "Failed to regenerate thread title", description: text, copy: text });
    });
  }
  function startRename() {
    editValue.current = session.title; setEditing(session.title); setError(null);
  }
  function finishRename() { editValue.current = null; setEditing(null); setError(null); }
  async function commit() {
    if (editValue.current === null || pending.current) return;
    const title = editValue.current.trim();
    if (!title) { setError("Enter a thread title."); return; }
    if (title === session.title) { finishRename(); return; }
    pending.current = true; setSaving(true); setError(null);
    try { await workspace.renameSession(session, title); finishRename(); }
    catch (error) { setError(sessionErrorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
  }
  const rowId = `session-row-${session.projectId}-${session.sessionId}`;
  async function toggleSettled() {
    if (pending.current) return;
    const restoreFocus = row.current?.parentElement?.contains(document.activeElement);
    pending.current = true; setSaving(true); setError(null);
    try {
      await workspace.settleSession(session, session.settledAt === null);
      requestAnimationFrame(() => {
        if (!restoreFocus || document.activeElement !== document.body) return;
        const target = session.settledAt === null ? document.querySelector<HTMLElement>(".settled-section__toggle") : document.getElementById(rowId);
        target?.focus({ preventScroll: true });
      });
    }
    catch (error) { setError(sessionErrorMessage(error)); }
    finally { pending.current = false; setSaving(false); }
  }
  function closeMenu(restoreFocus: boolean) {
    setMenu(null);
    if (restoreFocus) returnFocus(opener.current);
  }
  return <div className="session-list__row" data-editing={editing !== null || undefined} data-menu-open={!!menu || undefined} data-settled={session.settledAt !== null || undefined}
    onContextMenu={event => {
      if (editing !== null || workspace.busy) return;
      event.preventDefault(); opener.current = row.current; setMenu({ x: event.clientX, y: event.clientY });
    }}>
    <button ref={row} id={rowId} type="button" className="session-list__item" aria-label={session.title} aria-busy={regenerating || undefined}
      aria-current={active ? "page" : undefined} disabled={workspace.busy || editing !== null}
      onClick={() => { void workspace.open(session).then(onOpened, () => {}); }}
      onDoubleClick={startRename}
      onKeyDown={event => {
        if (event.key === "F2") { event.preventDefault(); startRename(); }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect();
          opener.current = row.current; setMenu({ x: bounds.left + 12, y: bounds.bottom });
        }
      }}>
      <span className="session-list__project">{project && <ProjectIcon project={project} />}<span className="session-list__project-name">{project?.name ?? "Project"}</span><time className="session-list__time" dateTime={new Date(session.updatedAt).toISOString()} title={new Date(session.updatedAt).toLocaleString()}>{sessionTime(session.settledAt ?? session.updatedAt, now)}</time></span>
      <span className="session-list__title" title={session.title} data-regenerating={regenerating || undefined}>{session.title}</span>
      <span className="session-list__detail">{status.label && <Tooltip label={status.label} delay={150} className="session-list__status" data-status={status.label.toLowerCase()}><span className="session-list__status-dot" aria-hidden="true" />{status.label}</Tooltip>}
        {session.workspace.worktreePath && <span className="session-list__worktree"
        title={`Worktree: ${folderName(session.workspace.worktreePath)}${session.workspace.branch ? ` (${session.workspace.branch})` : ""}`}>
        <WorkspaceIcon name="folder-git-2" /><span className="session-list__branch">{session.workspace.branch ?? folderName(session.workspace.worktreePath)}</span></span>}
        {mismatch && <span className="session-list__mismatch" title="You're currently checked out on another branch." aria-label={`Last ran on ${mismatch.threadBranch}; the checkout is on ${mismatch.currentBranch}`}><WorkspaceIcon name="circle-alert" /></span>}
        <img className="session-list__provider" src={openaiLogo} alt="OpenAI" title="OpenAI" width="14" height="14" /></span>
    </button>
    {editing !== null ? <input autoFocus className="session-list__rename" aria-label="Thread title" aria-invalid={!!error} aria-describedby={error ? `${menuId}-error` : undefined}
      value={editing} maxLength={160} readOnly={saving} onFocus={event => event.currentTarget.select()}
      onChange={event => { editValue.current = event.target.value; setEditing(event.target.value); setError(null); }}
      onBlur={() => { void commit(); }} onKeyDown={event => {
        if (event.key === "Escape" && !pending.current) { event.preventDefault(); finishRename(); requestAnimationFrame(() => { if (document.activeElement === document.body) row.current?.focus(); }); }
        if (event.key === "Enter") { event.preventDefault(); void commit().then(() => { if (editValue.current === null) row.current?.focus(); }); }
      }} /> : <div className="session-list__actions"><button type="button" className="session-list__settle" aria-label={`${session.settledAt === null ? "Settle" : "Unsettle"} ${session.title}`}
      title={session.settledAt === null ? "Settle thread" : "Unsettle thread"} disabled={workspace.busy || saving}
      onClick={() => { void toggleSettled(); }}>
      <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={session.settledAt === null ? "m3 8 3 3 7-7" : "M6 4 2 8l4 4M2 8h7a4 4 0 0 1 4 4"} /></svg>
      {session.settledAt === null && <span>Settle</span>}
    </button><button ref={optionsButton} type="button" className="session-list__options" aria-label={`Options for ${session.title}`} aria-haspopup="menu" aria-expanded={!!menu} aria-controls={menu ? menuId : undefined}
      disabled={workspace.busy} onClick={event => {
        if (menu) { closeMenu(true); return; }
        const bounds = event.currentTarget.getBoundingClientRect(); opener.current = event.currentTarget;
        setMenu({ x: bounds.right - 128, y: bounds.bottom + 4 });
      }}><svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1" /><circle cx="8" cy="8" r="1" /><circle cx="13" cy="8" r="1" /></svg></button></div>}
    {regenerating && <span role="status" className="session-list__sr-only">Regenerating title</span>}
    {error && <p id={`${menuId}-error`} className="session-list__warning" role="alert">{error}</p>}
    {menu && <SessionMenu id={menuId} {...menu} trigger={optionsButton} settled={session.settledAt !== null} onSettle={() => { void toggleSettled(); }} onClose={closeMenu} onRename={startRename} onDelete={() => onDelete(session)}
      regenerating={regenerating} onRegenerateTitle={regenerateTitle}
      onMarkUnread={status.markUnread}
      branch={session.workspace.branch} onNewOnBranch={() => {
        // T3 Code's "New thread on <branch>": the new session shares this one's worktree, or its branch in the checkout.
        void workspace.newSession(session.projectId, movedWorkspace(session.workspace.worktreePath, session.workspace.branch)).then(onOpened, error => setError(sessionErrorMessage(error)));
      }} />}
  </div>;
}
