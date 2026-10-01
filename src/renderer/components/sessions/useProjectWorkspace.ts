import type { DraftImage } from "../images/draft-storage";
import { useEffect, useRef, useState } from "react";
import { SessionError, type SessionLocation, type SessionPage } from "@contracts/sessions";
import type { SessionWorkspace } from "@contracts/session-workspace";
import { sessionErrorMessage } from "../../backend/sessions";
import { useModelCatalog } from "../composer/models/useModelCatalog";
import { useProjectScope } from "../sidebar/useProjectScope";
import { rememberActiveSession, restoreActiveSession } from "./activeSession";
import { useProjectDrafts } from "./useProjectDrafts";
import { useSessionWorkspace } from "./useSessionWorkspace";
import { useStartProjectSession } from "./useStartProjectSession";
import { defaultWorkspace, useWorktreeSettings } from "../composer/workspace/worktreeDefaults";

const emptyPage: SessionPage = { entries: [], nextBefore: null };
export function useProjectWorkspace() {
  const workspace = useSessionWorkspace();
  const [projectScope, setScope] = useProjectScope();
  const drafts = useProjectDrafts();
  const catalog = useModelCatalog();
  const start = useStartProjectSession();
  const worktreeSettings = useWorktreeSettings();
  const [draftMode, setDraftMode] = useState(() => {
    const active = restoreActiveSession();
    return !active || !!projectScope && drafts.get(projectScope).value?.sessionId === active.sessionId;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const projectId = projectScope && (draftMode || !workspace.document) ? projectScope : null;
  const state = projectId ? drafts.get(projectId) : null;
  // The thread on screen: the new thread being composed, before and while its first message creates it, or the open one.
  const viewing: SessionLocation | undefined = state?.value && projectId ? { projectId, sessionId: state.value.sessionId }
    : !projectId && workspace.document ? { projectId: workspace.document.projectId, sessionId: workspace.document.sessionId } : undefined;
  async function transition(work: () => Promise<void>) {
    if (guard.current) throw new Error("Workspace navigation is still busy");
    guard.current = true; setBusy(true); setError(null);
    try { drafts.flushAll(); await work(); }
    catch (error) { setError(sessionErrorMessage(error)); throw error; }
    finally { guard.current = false; setBusy(false); }
  }
  async function selectProject(projectId: string | null) {
    await transition(async () => {
      await workspace.flushDraft();
      setScope(projectId); setDraftMode(projectId !== null);
      rememberActiveSession(projectId ? null : workspace.document);
    });
  }
  async function open(location: SessionLocation) {
    await transition(async () => {
      if (!await workspace.open(location)) throw new Error("Session navigation is still busy");
      setDraftMode(false);
    });
  }
  async function send(message: string, images: readonly DraftImage[] = [], signal?: AbortSignal) {
    if (!projectId) return workspace.send(message, images, signal);
    let accepted: readonly string[] = [];
    await transition(async () => {
      const value = drafts.get(projectId).value;
      if (!value) throw new Error("Project draft is unavailable");
      // A session never sent from keeps following the project default until the user picks a workspace.
      const draft = { ...value, text: message, workspace: value.workspace ?? defaultWorkspace(worktreeSettings, projectId) };
      drafts.save(projectId, draft);
      const result = await start(projectId, draft, catalog.accountKey, catalog.selection, value => drafts.save(projectId, value), images, signal);
      accepted = result.sentImages;
      try {
        if (!await workspace.open(result.location)) throw new Error("Session navigation is still busy");
      } catch {
        throw new SessionError({ code: "STORAGE", message: "Your message was accepted, but the session could not be opened. Open it from the sidebar or retry to reconnect; it will not be sent again." });
      }
      drafts.clear(projectId); setDraftMode(false);
      if (result.stopWarning) setError("Your message was accepted, but Stop could not be confirmed. Check the response status; do not resend it.");
      else if (result.edited) setError("Your previous message was already sent. Your edited draft is ready to send as a follow-up.");
    });
    return accepted;
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      try { drafts.flushAll(); } catch { event.preventDefault(); event.returnValue = ""; }
      if (drafts.hasUnsaved()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  return { ...workspace, projectScope, selectProject, setProjectScope: setScope, projectDraftId: projectId,
    document: projectId ? null : workspace.document, page: projectId ? emptyPage : workspace.page,
    turn: projectId ? null : workspace.turn, running: !projectId && workspace.running,
    draft: state ? state.value?.text ?? "" : workspace.draft,
    busy: busy || workspace.busy, transitioning: busy || workspace.transitioning,
    dirty: state ? state.dirty : workspace.dirty,
    error: state?.error ?? error ?? (projectId ? null : workspace.error),
    canCompose: state ? !!state.value : !!workspace.document,
    viewing, imageLocation: viewing,
    prepareAttachments: async () => {
      if (projectId) { const value = drafts.get(projectId).value; if (!value) throw new Error("Project draft unavailable"); drafts.save(projectId, value); }
      else await workspace.flushDraft();
    },
    editDraft: (text: string) => {
      if (!projectId) return workspace.editDraft(text);
      const value = drafts.get(projectId).value;
      if (value) drafts.update(projectId, { ...value, text });
    },
    flushDraft: async () => {
      if (!projectId) return workspace.flushDraft();
      drafts.flush(projectId);
    },
    open, send,
    newSession: async (projectId: string, place?: SessionWorkspace) => transition(async () => { await workspace.newSession(projectId, place); setDraftMode(false); }),
    // Where the new session in the composer will work, saved with its draft until the first message creates it.
    draftWorkspace: state?.value?.workspace ?? null,
    setDraftWorkspace: (place: SessionWorkspace) => {
      if (!projectId) return;
      const value = drafts.get(projectId).value;
      if (value) drafts.save(projectId, { ...value, workspace: place });
    },
    discardDraft: () => {
      if (!projectId) return workspace.discardDraft();
      // Keep retry identities if a send may already have reached the backend.
      const value = drafts.get(projectId).value;
      if (value) { try { drafts.save(projectId, { ...value, text: "" }); } catch { /* Retain the storage error. */ } }
    },
  };
}
