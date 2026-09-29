import { SessionError, type SessionLocation } from "@contracts/sessions";
import { useImageDraft } from "../images/useImageDraft";
import { ImageGallery } from "../images/ImageGallery";
import type { DraftImage } from "../images/draft-storage";
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ComposerSettings } from "./ComposerSettings";
import { ComposerActions } from "./ComposerActions";
import "./composer.css";

type ComposerProps = {
  onSend?: (message: string, images: readonly DraftImage[], signal?: AbortSignal) => Promise<readonly string[] | void> | void;
  imageLocation?: SessionLocation; prepareAttachments?: () => Promise<void>;
  onStop?: () => void;
  stopLabel?: string;
  draft?: string; onDraftChange?: (value: string) => void; readOnly?: boolean; saveOnly?: boolean;
};

export function Composer({ onSend, onStop, stopLabel, draft: controlledDraft, onDraftChange, readOnly = false, saveOnly = false, imageLocation, prepareAttachments }: ComposerProps) {
  const [localDraft, setLocalDraft] = useState("");
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sendController = useRef<AbortController | null>(null);
  const composing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const attachments = useImageDraft(imageLocation);
  const picker = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const canAttach = Boolean(imageLocation && attachments.ready && !sending && !readOnly && !attachments.saving);
  const canSend = Boolean(onSend && (draft.trim() || attachments.images.length) && attachments.ready && !attachments.saving && !sending && !readOnly && !onStop);
  async function attach(files: File[]) {
    if (!canAttach || !files.length) return;
    try { await prepareAttachments?.(); await attachments.add(files); textarea.current?.focus(); }
    catch { setError("Could not save attachment draft. Your message has not been sent."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSend || !canSend || inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController(); sendController.current = controller;
    setSending(true);
    setError(null);
    try {
      if (imageLocation) await attachments.flush();
      const sent = [...attachments.images];
      controller.signal.throwIfAborted();
      const accepted = await onSend(draft, sent, controller.signal);
      if (sent.length) await attachments.sent(accepted ?? sent.map(image => image.id));
      if (controlledDraft === undefined) setDraft("");
    } catch (error) {
      setError(error instanceof SessionError ? error.message : controller.signal.aborted ? "Sending stopped. Your unsent message and attachments have been kept." : "Could not send. Your message and attachments are still here. Try again.");
    } finally {
      inFlight.current = false; sendController.current = null;
      setSending(false);
      textarea.current?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || composing.current || event.nativeEvent.keyCode === 229) return;
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSend && !event.repeat) event.currentTarget.form?.requestSubmit();
  }

  return (
    <form className="composer" data-image-drag={dragging || undefined} aria-label="Message composer" aria-busy={sending || Boolean(onStop)} onSubmit={submit}
      onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; if (canAttach) setDragging(true); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = canAttach ? "copy" : "none"; } }}
      onDragLeave={event => { if (event.dataTransfer.types.includes("Files")) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } }}
      onDrop={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current = 0; setDragging(false); void attach(Array.from(event.dataTransfer.files)); } }}>
      <input ref={picker} className="image-sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple tabIndex={-1} aria-label="Choose images" disabled={!canAttach}
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(files); }} />
      <ImageGallery images={attachments.images} draft disabled={!canAttach} onRemove={id => { void attachments.remove(id); }} />
      {attachments.error && <p className="composer__images-error" role="alert">{attachments.error}<button type="button" onClick={attachments.retry} disabled={attachments.saving}>Retry</button></p>}
      <textarea
        ref={textarea}
        className="composer__input flame-scrollbar"
        aria-label="Message"
        aria-describedby={hintId}
        placeholder="Ask for changes, send follow-ups, or attach images"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={event => { const files = Array.from(event.clipboardData.items).filter(item => item.kind === "file").map(item => item.getAsFile()).filter((file): file is File => file !== null); if (files.length) { event.preventDefault(); void attach(files); } }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }}
        readOnly={sending || readOnly}
        rows={1}
        spellCheck={false}
      />
      <span id={hintId} className={error ? "composer__hint" : "composer__status-hidden"} role="status">
        {error ?? (sending ? attachments.images.length ? "Preparing and sending images…" : "Sending…" : onSend ? "Shift + Enter for a new line" : "Agent not connected. Shift + Enter for a new line.")}
      </span>
      <div className="composer__footer">
        <ComposerSettings />
        <ComposerActions canSend={canSend} sending={sending} connected={Boolean(onSend)} saveOnly={saveOnly} onStop={sending ? () => { sendController.current?.abort(); onStop?.(); } : onStop} stopLabel={sending ? "Stop sending" : stopLabel} onAttach={canAttach ? () => picker.current?.click() : undefined} />
      </div>
    </form>
  );
}
