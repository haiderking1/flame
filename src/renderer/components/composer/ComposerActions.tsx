import "./composer-actions.css";

type ComposerActionsProps = {
  canSend: boolean;
  connected: boolean;
};

export function ComposerActions({ canSend, connected }: ComposerActionsProps) {
  return (
    <div className="composer-actions">
      <button
        className="composer-actions__attach"
        type="button"
        aria-label="Attach media"
        title="Media attachments are not available yet"
        disabled
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m20 11-8.5 8.5a5 5 0 0 1-7.07-7.07l9.2-9.2a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.2a2 2 0 0 1-2.83-2.83L15 6.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        className="composer-actions__send"
        type="submit"
        aria-label="Send message"
        disabled={!canSend}
        title={connected ? "Send message (Enter)" : "Connect an agent to send messages"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
