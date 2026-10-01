import { SessionError, type SessionLocation } from "@contracts/sessions";
import { useImageDraft } from "../images/useImageDraft";
import { ImageGallery } from "../images/ImageGallery";
import type { DraftImage } from "../images/draft-storage";
import { useId, useRef, useState, type FormEvent } from "react";
import { ComposerSettings } from "./ComposerSettings";
import { ComposerActions } from "./ComposerActions";
import { useSlashCommands } from "./slash/useSlashCommands";
import { SlashCommandList } from "./slash/SlashCommandList";
import { PromptEditor, type PromptEditorHandle } from "./editor/PromptEditor";
import { useFileMentions } from "./mentions/useFileMentions";
import { MentionMenu } from "./mentions/MentionMenu";
import { useSessions } from "../sessions/SessionContext";
import "./composer.css";

type ComposerProps = {
  onSend?: (message: string, images: readonly DraftImage[], signal?: AbortSignal) => Promise<readonly string[] | void> | void;
  imageLocation?: SessionLocation; prepareAttachments?: () => Promise<void>;
  onSendStart?: (message: string, images: readonly DraftImage[]) => ((accepted: boolean) => void) | undefined;
  pendingSend?: boolean;
  onStop?: () => void;
  stopLabel?: string;
  draft?: string; onDraftChange?: (value: string) => void; readOnly?: boolean; saveOnly?: boolean;
};

export function Composer({ onSend, onStop, stopLabel, draft: controlledDraft, onDraftChange, readOnly = false, saveOnly = false, imageLocation, prepareAttachments, onSendStart, pendingSend = false }: ComposerProps) {
  const [localDraft, setLocalDraft] = useState("");
  const draft = controlledDraft ?? localDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const sendController = useRef<AbortController | null>(null);
  const editor = useRef<PromptEditorHandle>(null), form = useRef<HTMLFormElement>(null);
  const [focused, setFocused] = useState(false), [cursor, setCursor] = useState<number | null>(null);
  const hintId = useId();
  const commands = useSlashCommands({ draft, setDraft, readOnly: sending || readOnly, input: editor, onError: setError });
  const sessions = useSessions();
  const projectId = sessions?.document?.projectId ?? sessions?.projectDraftId ?? sessions?.projectScope ?? null;
  const mentions = useFileMentions({ projectId, text: pendingSend ? "" : draft, cursor, focused, blocked: sending || pendingSend || readOnly || commands.isCommand, editor });
  const attachments = useImageDraft(imageLocation);
  const picker = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const canAttach = Boolean(imageLocation && attachments.ready && !sending && !pendingSend && !readOnly && !attachments.saving);
  const canSend = Boolean(onSend && (draft.trim() || attachments.images.length) && attachments.ready && !attachments.saving && !sending && !pendingSend && !readOnly && !onStop);
  async function attach(files: File[]) {
    if (!canAttach || !files.length) return;
    try { await prepareAttachments?.(); await attachments.add(files); editor.current?.focus(); }
    catch { setError("Could not save attachment draft. Your message has not been sent."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commands.isCommand) { await commands.execute(); return; }
    if (!onSend || !canSend || inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController(); sendController.current = controller;
    setSending(true);
    setError(null);
    const sent = [...attachments.images];
    const finishPreview = onSendStart?.(draft, sent);
    let acceptedSend = false;
    try {
      if (imageLocation) await attachments.flush();
      controller.signal.throwIfAborted();
      const accepted = await onSend(draft, sent, controller.signal);
      acceptedSend = true;
      if (sent.length) await attachments.sent(accepted ?? sent.map(image => image.id));
      if (controlledDraft === undefined) setDraft("");
    } catch (error) {
      setError(error instanceof SessionError ? error.message : controller.signal.aborted ? "Sending stopped. Your unsent message and attachments have been kept." : "Could not send. Your message and attachments are still here. Try again.");
    } finally {
      finishPreview?.(acceptedSend);
      inFlight.current = false; sendController.current = null;
      setSending(false);
      editor.current?.focus();
    }
  }

  // The editor skips this while an IME is composing; menus take their keys first.
  function handleKeyDown(event: KeyboardEvent): boolean {
    if (mentions.handleKeyDown(event) || commands.handleKeyDown(event)) return true;
    if (event.key !== "Enter" || event.shiftKey) return false;
    event.preventDefault();
    if ((canSend || commands.isCommand) && !event.repeat) form.current?.requestSubmit();
    return true;
  }
  const menu = commands.open ? { id: commands.listId, active: commands.activeId } : mentions.open ? { id: mentions.listId, active: mentions.activeId } : null;

  return (
    <form ref={form} className="composer" data-image-drag={dragging || undefined} aria-label="Message composer" aria-busy={sending || commands.launching || Boolean(onStop)} onSubmit={submit}
      onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; if (canAttach) setDragging(true); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = canAttach ? "copy" : "none"; } }}
      onDragLeave={event => { if (event.dataTransfer.types.includes("Files")) { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); } }}
      onDrop={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current = 0; setDragging(false); void attach(Array.from(event.dataTransfer.files)); } }}>
      {commands.open && <SlashCommandList id={commands.listId} input={form} commands={commands.matches} selectedIndex={commands.index}
        unavailable={commands.unavailable} onHighlight={commands.highlight} onExecute={command => { void commands.execute(command); }} />}
      {!commands.open && mentions.open && <MentionMenu id={mentions.listId} anchor={form} items={mentions.items} selectedIndex={mentions.index} status={mentions.status}
        pending={mentions.pending} onHighlight={mentions.highlight} onSelect={entry => { mentions.select(entry); }} />}
      <input ref={picker} className="image-sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple tabIndex={-1} aria-label="Choose images" disabled={!canAttach}
        onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(files); }} />
      <ImageGallery images={pendingSend ? [] : attachments.images} draft disabled={!canAttach} onRemove={id => { void attachments.remove(id); }} />
      {attachments.error && <p className="composer__images-error" role="alert">{attachments.error}<button type="button" onClick={attachments.retry} disabled={attachments.saving}>Retry</button></p>}
      <PromptEditor ref={editor} value={pendingSend ? "" : draft} ariaLabel="Message"
        placeholder="Ask for changes, @ to mention files, or attach images"
        readOnly={sending || pendingSend || readOnly || commands.launching}
        aria={{
          "aria-describedby": menu ? `${hintId} ${menu.id}-hint` : hintId,
          role: menu || commands.isCommand ? "combobox" : "textbox",
          "aria-autocomplete": menu || commands.isCommand ? "list" : undefined,
          "aria-expanded": menu || commands.isCommand ? String(!!menu) : undefined,
          "aria-controls": menu?.id, "aria-activedescendant": menu?.active,
        }}
        onChange={commands.onChange}
        onCursor={setCursor}
        onFocusChange={value => { setFocused(value); if (value) commands.onFocus(); else commands.onBlur(); }}
        onKeyDown={handleKeyDown}
        onFiles={files => { void attach(files); }} />
      <span id={hintId} className={error ? "composer__hint" : "composer__status-hidden"} role="status">
        {error ?? (sending ? attachments.images.length ? "Preparing and sending images…" : "Sending…" : onSend ? "Shift + Enter for a new line" : "Agent not connected. Shift + Enter for a new line.")}
      </span>
      <div className="composer__footer">
        <ComposerSettings />
        <ComposerActions canSend={commands.isCommand ? !readOnly && !sending && !commands.launching : canSend} sending={sending} connected={Boolean(onSend)} saveOnly={saveOnly} onStop={sending ? () => { sendController.current?.abort(); onStop?.(); } : onStop} stopLabel={sending ? "Stop sending" : stopLabel} onAttach={canAttach ? () => picker.current?.click() : undefined} />
      </div>
    </form>
  );
}
