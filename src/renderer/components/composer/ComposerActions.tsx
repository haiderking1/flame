import { ContextStatus } from "./ContextStatus";
import "./composer-actions.css";

type ComposerActionsProps = {
  canSend: boolean;
  sending: boolean;
  onStop?: () => void; onAttach?: () => void;
  stopLabel?: string;
  connected: boolean; saveOnly?: boolean;
};

export function ComposerActions({ canSend, sending, connected, saveOnly = false, onStop, stopLabel = "Stop response", onAttach }: ComposerActionsProps) {
  const showStop = Boolean(onStop) || (sending && !saveOnly);
  return (
    <div className="composer-actions">
      <button
        className="composer-actions__attach"
        type="button"
        aria-label="Attach media"
        title="Attach images"
        disabled={!onAttach}
        onPointerDown={event => event.preventDefault()}
        onClick={onAttach}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m20 11-8.5 8.5a5 5 0 0 1-7.07-7.07l9.2-9.2a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.2a2 2 0 0 1-2.83-2.83L15 6.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <ContextStatus />
      <button
        className="composer-actions__send"
        data-active={sending || Boolean(onStop)}
        data-stop={showStop}
        type={showStop ? "button" : "submit"}
        onClick={onStop}
        aria-label={onStop ? stopLabel : sending ? "Sending message" : saveOnly ? "Save message to session" : "Send message"}
        disabled={!onStop && !canSend}
        title={onStop ? stopLabel : sending ? "Sending message…" : saveOnly ? "Save message locally (Enter). Agent execution is not connected yet." : connected ? "Send message (Enter)" : "Connect an agent to send messages"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect className="composer-actions__stop-icon" x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          <path className="composer-actions__send-icon" d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
