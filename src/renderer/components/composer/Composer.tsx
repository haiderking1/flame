import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ComposerSettings } from "./ComposerSettings";
import { ComposerActions } from "./ComposerActions";
import "./composer.css";

type ComposerProps = {
  onSend?: (message: string) => Promise<void> | void;
};

export function Composer({ onSend }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const canSend = Boolean(onSend && draft.trim() && !sending);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSend || !draft.trim() || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await onSend(draft);
      setDraft("");
    } catch {
      setError("Could not send. Your message is still here. Try again.");
    } finally {
      inFlight.current = false;
      setSending(false);
      textarea.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing ||
        composing.current || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    if (canSend && !event.repeat) event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="composer" aria-label="Message composer" aria-busy={sending} onSubmit={submit}>
      <textarea
        ref={textarea}
        className="composer__input flame-scrollbar"
        aria-label="Message"
        aria-describedby={hintId}
        placeholder="Ask for changes, send follow-ups, or attach images"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        readOnly={sending}
        rows={1}
        spellCheck={false}
      />
      <span id={hintId} className={error || sending ? "composer__hint" : "composer__status-hidden"} role="status">
        {error ?? (sending ? "Sending…" : onSend ? "Shift + Enter for a new line" : "Agent not connected. Shift + Enter for a new line.")}
      </span>
      <div className="composer__footer">
        <ComposerSettings />
        <ComposerActions canSend={canSend} connected={Boolean(onSend)} />
      </div>
    </form>
  );
}
