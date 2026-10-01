import { lazy, Profiler, Suspense, useMemo, useRef, useState } from "react";
import type { SessionEntry } from "@contracts/sessions";
import { recordCommit } from "../../lib/performance";
import { Composer } from "../composer/Composer";
import { BranchToolbar } from "../composer/workspace/BranchToolbar";
import { EditMessageContext } from "./work/editMessage";
import { useActiveWorkspace } from "../workspace/useActiveWorkspace";
import { followUpScope, followUpStore } from "../composer/followUps/followUpStore";
import { anchorOf } from "../composer/followUps/followUpLogic";
import { BranchMismatchBanner } from "../composer/workspace/BranchMismatchBanner";
import { useSessions } from "./SessionContext";
import { SessionDialog } from "./SessionDialog";
import "./session-workspace.css";
import "./session-empty.css";
import { SessionTimeline } from "./work/SessionTimeline";
import { useComposerOverlay } from "./useComposerOverlay";
import { useHistoryScroll } from "./useHistoryScroll";
import { usePendingImageMessage } from "./usePendingImageMessage";
import { UserMessage } from "./work/UserMessage";
import { HistoryScrollContext } from "../virtual/HistoryScrollContext";
import { ComposerRestingContext, useComposerResting } from "../composer/resting/useComposerResting";
import { AgentsBanner } from "../agents/AgentsBanner";

// Loaded when first opened, so the dialog stays out of the startup bundle.
const EditFromHereDialog = lazy(() => import("./EditFromHereDialog"));
export function SessionWorkspace() {
  const sessions = useSessions()!;
  const [discarding, setDiscarding] = useState(false);
  const active = sessions.document;
  const scope = active ? followUpScope(active) : null;
  const [editing, setEditing] = useState<SessionEntry | null>(null);
  const { summary } = useActiveWorkspace();
  const editMessage = useMemo(() => ({ request: setEditing, disabled: sessions.running || sessions.busy }), [sessions.running, sessions.busy]);
  const preview = usePendingImageMessage(sessions.imageLocation);
  const pending = preview.message?.sending ? preview.message : null;
  const empty = !pending && !sessions.turn && !sessions.page.nextBefore && !sessions.page.entries.some(entry => entry.kind !== "settings");
  const close = () => setDiscarding(false);
  const history = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const resting = useComposerResting({ history, thread: !!active && !empty, sessionKey: active ? `${active.projectId}:${active.sessionId}` : "", draft: sessions.draft });
  useComposerOverlay(composer, history, resting.resting);
  const saveState = sessions.busy ? "saving" : sessions.dirty ? "unsaved" : "saved";
  const captureHistoryAnchor = useHistoryScroll(history, `${active?.projectId ?? ""}:${active?.sessionId ?? ""}`, sessions.page.entries, `${sessions.turn?.text ?? ""}:${pending?.id ?? ""}`);
  return <>
    <div ref={history} hidden={(!active && !pending) || empty} className="session-history flame-scrollbar" role="region" tabIndex={0} aria-label="Session history">
      <div className="session-history__content">
      {sessions.page.nextBefore && <button className="session-history__older" disabled={sessions.busy} onClick={() => { captureHistoryAnchor(); void sessions.loadOlder().catch(() => {}); }}>Load earlier messages</button>}
      {active ? <EditMessageContext value={editMessage}><HistoryScrollContext value={history}><Profiler id="timeline" onRender={recordCommit}><SessionTimeline key={`${active.projectId}:${active.sessionId}`} location={active} entries={sessions.page.entries} compactions={sessions.page.compactions} turn={sessions.turn} revision={active.revision} imagePreview={preview.message} /></Profiler></HistoryScrollContext></EditMessageContext>
        : pending && <UserMessage text={pending.text} images={pending.images} pending />}
      </div>
    </div>
    <ComposerRestingContext value={resting}>
    <div ref={composer} className="workspace__composer" data-empty={empty || undefined} data-save-state={saveState} data-resting={resting.resting || undefined}>
      {empty && <h1 className="session-empty__heading">What are we cooking?</h1>}
      {sessions.error && <div className="session-error" role="alert">{sessions.error}
        {active && <button disabled={sessions.busy} onClick={() => { void sessions.reload().catch(() => {}); }}>Reload saved state</button>}
        {sessions.dirty && <><button disabled={sessions.busy} onClick={() => { void sessions.flushDraft().catch(() => {}); }}>Retry save</button>
          <button disabled={sessions.busy} onClick={() => setDiscarding(true)}>Discard local draft</button></>}
      </div>}
      <BranchMismatchBanner />
      {active && !sessions.running && <AgentsBanner thread={active} />}
      <Composer key={active ? `${active.projectId}:${active.sessionId}` : sessions.projectDraftId ?? "empty"} draft={sessions.draft} onDraftChange={sessions.editDraft}
        readOnly={!sessions.canCompose || sessions.transitioning} onSend={sessions.canCompose ? sessions.send : undefined}
        imageLocation={sessions.imageLocation} prepareAttachments={sessions.prepareAttachments}
        onSendStart={preview.begin} pendingSend={!!pending}
        onStop={sessions.running ? () => { if (scope) followUpStore.giveBack(scope); void sessions.stop(); } : undefined}
        followUpScope={scope} onFollowUp={scope && sessions.running ? (text, images, mode) => { followUpStore.enqueue(scope, { text, images, mode, anchor: anchorOf(sessions.turn) }); } : undefined} stopLabel={sessions.turn?.phase === "compacting" ? "Stop compaction" : "Stop response"} saveOnly={!sessions.projectDraftId && !active?.settings} />
      <BranchToolbar />
    </div>
    </ComposerRestingContext>
    {editing && active && <Suspense fallback={null}><EditFromHereDialog entry={editing} worktree={!!(summary?.workspace ?? active.workspace).worktreePath} onClose={() => setEditing(null)} /></Suspense>}
    {discarding && <SessionDialog title="Discard unsaved draft?" busy={sessions.busy} error={sessions.error}
      onClose={close} action="Discard draft" destructive onSubmit={() => { sessions.discardDraft(); close(); }}>
      <p>Discard only the unsaved text in this window? Saved session history will not be changed.</p>
    </SessionDialog>}
  </>;
}
