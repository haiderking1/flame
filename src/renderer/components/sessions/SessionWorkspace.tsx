import { useRef, useState } from "react";
import { Composer } from "../composer/Composer";
import { useSessions } from "./SessionContext";
import { SessionDialog } from "./SessionDialog";
import "./session-workspace.css";
import { TurnResponse } from "./TurnResponse";
import { useComposerOverlay } from "./useComposerOverlay";
import { useHistoryScroll } from "./useHistoryScroll";

export function SessionWorkspace() {
  const sessions = useSessions()!;
  const [discarding, setDiscarding] = useState(false);
  const active = sessions.document;
  const close = () => setDiscarding(false);
  const history = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  useComposerOverlay(composer, history);
  const saveState = sessions.busy ? "saving" : sessions.dirty ? "unsaved" : "saved";
  useHistoryScroll(history, `${active?.projectId ?? ""}:${active?.sessionId ?? ""}`, sessions.page.entries, sessions.turn?.text);
  return <>
    <div ref={history} hidden={!active} className="session-history flame-scrollbar" role="region" aria-label="Session history">
      <div className="session-history__content">
      {sessions.page.nextBefore && <button className="session-history__older" disabled={sessions.busy} onClick={() => { void sessions.loadOlder().catch(() => {}); }}>Load earlier messages</button>}
      {sessions.page.entries.filter((entry) => entry.kind !== "settings").map((entry) =>
        <article key={entry.id} className={`session-message${entry.kind === "assistant" ? " session-message--assistant" : ""}`}><span>{entry.kind === "user" ? "You" : `Flame${entry.turnStatus && entry.turnStatus !== "completed" ? ` · ${entry.turnStatus}` : ""}`}</span><p>{entry.text}</p></article>)}
      <TurnResponse turn={sessions.turn} revision={active?.revision ?? 0} />
      </div>
    </div>
    <div ref={composer} className="workspace__composer" data-save-state={saveState}>
      {!active && <p className="session-status" role="status">Create or open a session to start</p>}
      {sessions.error && <div className="session-error" role="alert">{sessions.error}
        {active && <button disabled={sessions.busy} onClick={() => { void sessions.reload().catch(() => {}); }}>Reload saved state</button>}
        {sessions.dirty && <><button disabled={sessions.busy} onClick={() => { void sessions.flushDraft().catch(() => {}); }}>Retry save</button>
          <button disabled={sessions.busy} onClick={() => setDiscarding(true)}>Discard local draft</button></>}
      </div>}
      <Composer key={active ? `${active.projectId}:${active.sessionId}` : "empty"} draft={sessions.draft} onDraftChange={sessions.editDraft}
        readOnly={!active || sessions.transitioning} onSend={active ? sessions.send : undefined}
        onStop={sessions.running ? () => { void sessions.stop(); } : undefined} saveOnly={!active?.settings} />
    </div>
    {discarding && <SessionDialog title="Discard unsaved draft?" busy={sessions.busy} error={sessions.error}
      onClose={close} action="Discard draft" destructive onSubmit={() => { sessions.discardDraft(); close(); }}>
      <p>Discard only the unsaved text in this window? Saved session history will not be changed.</p>
    </SessionDialog>}
  </>;
}
