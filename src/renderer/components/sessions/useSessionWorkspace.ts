import { useUploadImages } from "../images/useUploadImages";
import { saveImageDraft, type DraftImage } from "../images/draft-storage";
import { useEffect, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { ModelSelection } from "@contracts/models";
import { fitsSessionText, SessionError, type SessionDocument, type SessionLocation, type SessionPage, type SessionSummary } from "@contracts/sessions";
import { changeSession, createSession, deleteSession, readSession, sessionErrorMessage, sessionHistory } from "../../backend/sessions";
import { startTurn, stopTurn } from "../../backend/turns";
import { useTurnState } from "./useTurnState";
import { rememberActiveSession, restoreActiveSession } from "./activeSession";
import { useManualCompaction } from "./useManualCompaction";

type Change = { type: "draft"; draft: string } | { type: "rename"; title: string }
  | { type: "run"; requestId: string; text: string; accountKey: string; images?: readonly string[] }
  | { type: "append"; requestId: string; text: string; images?: readonly string[] } | { type: "configure"; accountKey: string; settings: ModelSelection };
export function useSessionWorkspace() {
  const upload = useUploadImages();
  const stopAccepted = useAtomSet(stopTurn, { mode: "promise" });
  const run = useAtomSet(startTurn, { mode: "promise" });
  const read = useAtomSet(readSession, { mode: "promise" });
  const create = useAtomSet(createSession, { mode: "promise" });
  const history = useAtomSet(sessionHistory, { mode: "promise" });
  const change = useAtomSet(changeSession, { mode: "promise" });
  const remove = useAtomSet(deleteSession, { mode: "promise" });
  const [document, setDocument] = useState<SessionDocument | null>(null);
  const turnState = useTurnState(document);
  const [page, setPage] = useState<SessionPage>({ entries: [], nextBefore: null });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [awaitingMessageHistory, setAwaitingMessageHistory] = useState(false);
  const current = useRef<SessionDocument | null>(null);
  const text = useRef("");
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const navigating = useRef(false);
  const pendingSend = useRef<{ projectId: string; sessionId: string; requestId: string; text: string; images: readonly string[] } | null>(null);
  const restoredTurn = useRef("");
  const pendingCreate = useRef<SessionLocation | null>(null);
  function adopt(value: SessionDocument) { current.current = value; setDocument(value); }
  function enqueue<T>(work: () => Promise<T>, reportError = true): Promise<T> {
    setPending((value) => value + 1);
    const result = queue.current.then(work);
    queue.current = result.then(() => {}, () => {});
    return result.catch((error) => { if (reportError) setError(sessionErrorMessage(error)); throw error; })
      .finally(() => setPending((value) => value - 1));
  }
  function mutate(input: Change) {
    const target = current.current;
    return enqueue(async () => {
      const latest = current.current;
      if (!target || !latest || latest.sessionId !== target.sessionId || latest.projectId !== target.projectId) throw new Error("Session changed");
      if (input.type === "configure" && JSON.stringify(latest.settings) !== JSON.stringify(target.settings)) {
        throw new SessionError({ code: "CONFLICT", message: "Session model settings changed. Open the picker and choose again." });
      }
      const location = { projectId: latest.projectId, sessionId: latest.sessionId, revision: latest.revision };
      const result = input.type === "run" ? await run({ ...location, ...input }) : await change({ ...location, ...input });
      adopt(result); setError(null);
      return result;
    });
  }
  async function flushDraft() {
    clearTimeout(timer.current);
    await enqueue(async () => {
      const latest = current.current;
      if (!latest || text.current === latest.draft) return;
      if (!fitsSessionText(text.current)) throw new SessionError({ code: "INVALID", message: "Draft exceeds the 48 KiB encoded message limit. Shorten it before saving." });
      const saved = await change({ type: "draft", projectId: latest.projectId, sessionId: latest.sessionId, revision: latest.revision, draft: text.current });
      adopt(saved); setError(null);
    });
  }
  function editDraft(value: string) {
    text.current = value; setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushDraft().catch(() => {}); }, 400);
  }
  const compact = useManualCompaction({ current, accountKey: turnState.accountKey, running: turnState.running, turn: turnState.turn, flushDraft, enqueue, adopt });
  async function open(location: SessionLocation) {
    if (navigating.current) return false;
    navigating.current = true; setTransitioning(true);
    try {
      await flushDraft();
      await enqueue(async () => {
        const loaded = await read(location);
        const messages = await history({ ...location, before: null });
        adopt(loaded); setPage(messages); text.current = loaded.draft; setDraft(loaded.draft);
        pendingSend.current = null; rememberActiveSession(location); setError(null);
      });
    } finally { navigating.current = false; setTransitioning(false); }
    return true;
  }
  async function newSession(projectId: string) {
    if (navigating.current) return;
    navigating.current = true; setTransitioning(true);
    try {
      await flushDraft();
      const location = pendingCreate.current?.projectId === projectId ? pendingCreate.current : { projectId, sessionId: crypto.randomUUID() };
      pendingCreate.current = location;
      await enqueue(async () => {
        const loaded = await create(location);
        const messages = await history({ ...location, before: null });
        adopt(loaded); setPage(messages);
        text.current = loaded.draft; setDraft(loaded.draft); pendingSend.current = null;
        rememberActiveSession(location); pendingCreate.current = null; setError(null);
      });
    } finally { navigating.current = false; setTransitioning(false); }
  }
  async function send(message: string, images: readonly DraftImage[] = [], signal?: AbortSignal) {
    setAwaitingMessageHistory(true);
    try { await submitMessage(message, images, signal); return images.map(image => image.id); }
    finally { setAwaitingMessageHistory(false); }
  }
  async function submitMessage(message: string, attachments: readonly DraftImage[], signal?: AbortSignal) {
    const images = attachments.map(image => image.id);
    const previous = pendingSend.current;
    if (!(previous?.sessionId === current.current?.sessionId && previous?.projectId === current.current?.projectId && previous?.text === message && JSON.stringify(previous.images) === JSON.stringify(images))) {
      await flushDraft();
      if (!current.current) throw new Error("No active session");
      pendingSend.current = { projectId: current.current.projectId, sessionId: current.current.sessionId, requestId: crypto.randomUUID(), text: message, images };
    }
    const target = current.current!;
    await upload({ projectId: target.projectId, sessionId: target.sessionId }, attachments, signal);
    if (current.current?.projectId !== target.projectId || current.current?.sessionId !== target.sessionId) throw new Error("Session changed during image upload");
    const saved = await mutate(current.current?.settings
      ? { type: "run", requestId: pendingSend.current!.requestId, text: message, accountKey: turnState.accountKey, images }
      : { type: "append", requestId: pendingSend.current!.requestId, text: message, images });
    if (signal?.aborted && target.settings) {
      try { await stopAccepted({ projectId: target.projectId, sessionId: target.sessionId, turnId: pendingSend.current!.requestId }); }
      catch { setError("Your message was accepted, but Stop could not be confirmed. Check the response status; do not resend it."); }
    }
    pendingSend.current = null;
    if (text.current === message) { text.current = saved.draft; setDraft(saved.draft); }
    await refreshHistory(saved);
  }
  async function refreshHistory(saved: SessionDocument) {
    try {
      await enqueue(async () => {
        const messages = await history({ projectId: saved.projectId, sessionId: saved.sessionId, before: null });
        if (current.current?.projectId === saved.projectId && current.current?.sessionId === saved.sessionId && current.current.leafId === saved.leafId) setPage(messages);
      });
    } catch { setError("Changes saved, but history could not be loaded. Reload saved state to retry."); }
  }
  function editSession(target: SessionSummary, action: { type: "rename"; title: string } | { type: "settle"; settled: boolean } | { type: "delete" }) {
    return enqueue(async () => {
      const active = current.current;
      const isActive = active?.projectId === target.projectId && active.sessionId === target.sessionId;
      const location = { projectId: target.projectId, sessionId: target.sessionId, revision: isActive ? active.revision : target.revision };
      if (action.type !== "delete") {
        const saved = await change({ ...location, ...action });
        if (isActive) adopt(saved);
      } else {
        await remove(location);
        void saveImageDraft(`${location.projectId}:${location.sessionId}`, []).catch(() => {});
        if (isActive) {
          clearTimeout(timer.current);
          current.current = null; setDocument(null); text.current = ""; setDraft("");
          setPage({ entries: [], nextBefore: null }); rememberActiveSession(null); pendingSend.current = null; setError(null);
        }
      }
    }, false);
  }
  async function loadOlder() {
    const target = current.current;
    if (!target || !page.nextBefore) return;
    await enqueue(async () => {
      const older = await history({ projectId: target.projectId, sessionId: target.sessionId, before: page.nextBefore });
      if (current.current?.sessionId === target.sessionId && current.current?.projectId === target.projectId) setPage((page) => ({ entries: [...older.entries, ...page.entries], nextBefore: older.nextBefore,
        compactions: [...new Map([...(older.compactions ?? []), ...(page.compactions ?? [])].map(item => [item.id, item])).values()] }));
    });
  }
  async function reload() {
    if (navigating.current || !current.current) return;
    navigating.current = true; setTransitioning(true); clearTimeout(timer.current);
    try {
      await enqueue(async () => {
        const target = current.current!;
        const keepDraft = text.current !== target.draft;
        const loaded = await read(target);
        const messages = await history({ ...target, before: null });
        adopt(loaded); setPage(messages);
        if (!keepDraft) {
          text.current = loaded.draft; setDraft(loaded.draft);
          if (turnState.turn?.status !== "running" && pendingSend.current?.requestId === turnState.turn?.id) pendingSend.current = null;
        }
        setError(keepDraft && text.current !== loaded.draft ? "Saved state reloaded. Your local draft is still unsaved; retry saving or discard it." : null);
      });
    } finally { navigating.current = false; setTransitioning(false); }
  }
  useEffect(() => {
    const saved = restoreActiveSession();
    if (saved) void open(saved).catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!current.current || (text.current === current.current.draft && pending === 0)) return;
      event.preventDefault(); event.returnValue = "";
      void flushDraft().catch(() => {});
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);
  useEffect(() => {
    const turn = turnState.turn;
    if (turn && turn.status !== "running" && current.current && turn.revision > current.current.revision && pending === 0 && !transitioning && restoredTurn.current !== `${turn.id}:${turn.revision}`) {
      restoredTurn.current = `${turn.id}:${turn.revision}`;
      void reload().catch(() => {});
    }
  }, [turnState.turn?.id, turnState.turn?.status, turnState.turn?.revision, pending, transitioning, document?.revision]);
  return { document, page, draft, error, transitioning, turn: awaitingMessageHistory ? null : turnState.turn, running: turnState.running,
    stop: () => turnState.stop().catch((error) => { setError(sessionErrorMessage(error)); }), busy: pending > 0 || transitioning, dirty: !!document && draft !== document.draft,
    editDraft, open, newSession, send, loadOlder, reload, flushDraft, compact, accountKey: turnState.accountKey,
    renameSession: (target: SessionSummary, title: string) => editSession(target, { type: "rename", title }),
    settleSession: (target: SessionSummary, settled: boolean) => editSession(target, { type: "settle", settled }),
    deleteSession: (target: SessionSummary) => editSession(target, { type: "delete" }),
    configure: async (accountKey: string, settings: ModelSelection) => {
      const saved = await mutate({ type: "configure", accountKey, settings });
      await refreshHistory(saved);
      return saved;
    },
    discardDraft: () => { clearTimeout(timer.current); text.current = current.current?.draft ?? ""; setDraft(text.current); setError(null); },
  };
}
