import { useRef, useState } from "react";
import { Composer } from "../composer/Composer";
import { useSessions } from "./SessionContext";
import { SessionDialog } from "./SessionDialog";
import "./session-workspace.css";
import "./session-empty.css";
import { SessionTimeline } from "./work/SessionTimeline";
import { useComposerOverlay } from "./useComposerOverlay";
import { useHistoryScroll } from "./useHistoryScroll";

export function SessionWorkspace() {
  const sessions = useSessions()!;
  const [discarding, setDiscarding] = useState(false);
  const active = sessions.document;
  const empty = !sessions.turn && !sessions.page.nextBefore && !sessions.page.entries.some(entry => entry.kind !== "settings");
  const close = () => setDiscarding(false);
  const history = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  useComposerOverlay(composer, history);
  const saveState = sessions.busy ? "saving" : sessions.dirty ? "unsaved" : "saved";
  useHistoryScroll(history, `${active?.projectId ?? ""}:${active?.sessionId ?? ""}`, sessions.page.entries, sessions.turn?.text);
  return <>
    <div ref={history} hidden={!active || empty} className="session-history flame-scrollbar" role="region" aria-label="Session history">
      <div className="session-history__content">
      {sessions.page.nextBefore && <button className="session-history__older" disabled={sessions.busy} onClick={() => { void sessions.loadOlder().catch(() => {}); }}>Load earlier messages</button>}
      {active && <SessionTimeline key={`${active.projectId}:${active.sessionId}`} location={active} entries={sessions.page.entries} turn={sessions.turn} revision={active.revision} />}
      </div>
    </div>
    <div ref={composer} className="workspace__composer" data-empty={empty || undefined} data-save-state={saveState}>
      {empty && <h1 className="session-empty__heading">What are we cooking?</h1>}
      {sessions.error && <div className="session-error" role="alert">{sessions.error}
        {active && <button disabled={sessions.busy} onClick={() => { void sessions.reload().catch(() => {}); }}>Reload saved state</button>}
        {sessions.dirty && <><button disabled={sessions.busy} onClick={() => { void sessions.flushDraft().catch(() => {}); }}>Retry save</button>
          <button disabled={sessions.busy} onClick={() => setDiscarding(true)}>Discard local draft</button></>}
      </div>}
      <Composer key={active ? `${active.projectId}:${active.sessionId}` : sessions.projectDraftId ?? "empty"} draft={sessions.draft} onDraftChange={sessions.editDraft}
        readOnly={!sessions.canCompose || sessions.transitioning} onSend={sessions.canCompose ? sessions.send : undefined}
        imageLocation={sessions.imageLocation} prepareAttachments={sessions.prepareAttachments}
        onStop={sessions.running ? () => { void sessions.stop(); } : undefined} saveOnly={!sessions.projectDraftId && !active?.settings} />
    </div>
    {discarding && <SessionDialog title="Discard unsaved draft?" busy={sessions.busy} error={sessions.error}
      onClose={close} action="Discard draft" destructive onSubmit={() => { sessions.discardDraft(); close(); }}>
      <p>Discard only the unsaved text in this window? Saved session history will not be changed.</p>
    </SessionDialog>}
  </>;
}
