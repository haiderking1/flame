import { useEffect, useRef, useState } from "react";
import { SessionError, type SessionLocation } from "@contracts/sessions";
import { sessionErrorMessage } from "../../backend/sessions";
import { useModelCatalog } from "../composer/models/useModelCatalog";
import { useProjectScope } from "../sidebar/useProjectScope";
import { rememberActiveSession, restoreActiveSession } from "./activeSession";
import { useProjectDrafts } from "./useProjectDrafts";
import { useSessionWorkspace } from "./useSessionWorkspace";
import { useStartProjectSession } from "./useStartProjectSession";

const emptyPage = { entries: [], nextBefore: null } as const;
export function useProjectWorkspace() {
  const workspace = useSessionWorkspace();
  const [projectScope, setScope] = useProjectScope();
  const drafts = useProjectDrafts();
  const catalog = useModelCatalog();
  const start = useStartProjectSession();
  const [draftMode, setDraftMode] = useState(() => {
    const active = restoreActiveSession();
    return !active || !!projectScope && drafts.get(projectScope).value?.sessionId === active.sessionId;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const projectId = projectScope && (draftMode || !workspace.document) ? projectScope : null;
  const state = projectId ? drafts.get(projectId) : null;
  async function transition(work: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true; setBusy(true); setError(null);
    try { await work(); }
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
  async function send(message: string) {
    if (!projectId) return workspace.send(message);
    await transition(async () => {
      const value = drafts.get(projectId).value;
      if (!value) throw new Error("Project draft is unavailable");
      const draft = { ...value, text: message };
      drafts.save(projectId, draft);
      const result = await start(projectId, draft, catalog.accountKey, catalog.selection, value => drafts.save(projectId, value));
      try {
        if (!await workspace.open(result.location)) throw new Error("Session navigation is still busy");
      } catch {
        throw new SessionError({ code: "STORAGE", message: "Your message was accepted, but the session could not be opened. Open it from the sidebar or retry to reconnect; it will not be sent again." });
      }
      drafts.clear(projectId); setDraftMode(false);
      if (result.edited) setError("Your previous message was already sent. Your edited draft is ready to send as a follow-up.");
    });
  }
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
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
    editDraft: (text: string) => {
      if (!projectId) return workspace.editDraft(text);
      const value = drafts.get(projectId).value;
      if (value) { try { drafts.save(projectId, { ...value, text }); } catch { /* The draft error stays visible; text remains in memory. */ } }
    },
    flushDraft: async () => {
      if (!projectId) return workspace.flushDraft();
      const value = drafts.get(projectId).value;
      if (value) drafts.save(projectId, value);
    },
    open, send,
    newSession: async (projectId: string) => transition(async () => { await workspace.newSession(projectId); setDraftMode(false); }),
    discardDraft: () => {
      if (!projectId) return workspace.discardDraft();
      // Keep retry identities if a send may already have reached the backend.
      const value = drafts.get(projectId).value;
      if (value) { try { drafts.save(projectId, { ...value, text: "" }); } catch { /* Retain the storage error. */ } }
    },
  };
}
