import { useActiveWorkspace } from "../workspace/useActiveWorkspace";
import { SessionError, type SessionLocation } from "@contracts/sessions";
import { useImageDraft } from "../images/useImageDraft";
import { ImageGallery } from "../images/ImageGallery";
import type { DraftImage } from "../images/draft-storage";
import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ComposerSettings } from "./ComposerSettings";
import { ComposerActions } from "./ComposerActions";
import { useSlashCommands } from "./slash/useSlashCommands";
import { SlashCommandList } from "./slash/SlashCommandList";
import { PromptEditor, type PromptEditorHandle } from "./editor/PromptEditor";
import { useFileMentions } from "./mentions/useFileMentions";
import { MentionMenu } from "./mentions/MentionMenu";
import { useComposerFollowUps } from "./followUps/useComposerFollowUps";
import type { FollowUpMode } from "./followUps/followUpLogic";
import { useComposerRestingState } from "./resting/useComposerResting";
import { RestingImageCount } from "./resting/RestingImageCount";
import "./composer.css";
import "./resting/resting.css";

type ComposerProps = {
  onSend?: (message: string, images: readonly DraftImage[], signal?: AbortSignal) => Promise<readonly string[] | void> | void;
  imageLocation?: SessionLocation; prepareAttachments?: () => Promise<void>;
  onSendStart?: (message: string, images: readonly DraftImage[]) => ((accepted: boolean) => void) | undefined;
  pendingSend?: boolean;
  onStop?: () => void;
  stopLabel?: string;
  draft?: string; onDraftChange?: (value: string) => void; readOnly?: boolean; saveOnly?: boolean;
  // While the agent works: where follow-ups queue, and how a new one is added.
  followUpScope?: string | null; onFollowUp?: (text: string, images: readonly DraftImage[], mode: FollowUpMode) => void;
};

export function Composer({ onSend, onStop, stopLabel, draft: controlledDraft, onDraftChange, readOnly = false, saveOnly = false, imageLocation, prepareAttachments, onSendStart, pendingSend = false,
  followUpScope = null, onFollowUp }: ComposerProps) {
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
  const { key: workspace } = useActiveWorkspace();
  const mentions = useFileMentions({ workspace, text: pendingSend ? "" : draft, cursor, focused, blocked: sending || pendingSend || readOnly || commands.isCommand, editor });
  const attachments = useImageDraft(imageLocation);
  const followUps = useComposerFollowUps({ scope: followUpScope, running: Boolean(onStop), enqueue: onFollowUp, draft, setDraft, attachments,
    blocked: sending || pendingSend || readOnly || commands.isCommand });
  const picker = useRef<HTMLInputElement>(null), dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const canAttach = Boolean(imageLocation && attachments.ready && !sending && !pendingSend && !readOnly && !attachments.saving);
  const canSend = Boolean(onSend && (draft.trim() || attachments.images.length) && attachments.ready && !attachments.saving && !sending && !pendingSend && !readOnly && !onStop);
  const restingState = useComposerRestingState(), resting = !!restingState?.resting;
  // A menu, a drag or an error needs the full composer; so does a draft longer than one line, measured at full width.
  const held = commands.open || mentions.open || dragging || !!error || !!attachments.error;
  const multiline = useRef(false);
  useLayoutEffect(() => {
    if (!resting) {
      const input = form.current?.querySelector<HTMLElement>(".composer__input"), line = input?.firstElementChild;
      const height = line ? line.getBoundingClientRect().height : 0, lineHeight = line ? parseFloat(getComputedStyle(line).lineHeight) : 0;
      multiline.current = draft.includes("\n") || (input?.childElementCount ?? 0) > 1 || (lineHeight > 0 && height > lineHeight + 1);
    }
    restingState?.report({ held, multiline: multiline.current });
  });
  async function attach(files: File[]) {
    if (!canAttach || !files.length) return;
    try { await prepareAttachments?.(); await attachments.add(files); editor.current?.focus(); }
    catch { setError("Could not save attachment draft. Your message has not been sent."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (commands.isCommand) { await commands.execute(); return; }
    if (followUps.canFollowUp) {
      try { await followUps.submit(); editor.current?.focus(); }
      catch { setError("Could not queue your message. It and its attachments are still here. Try again."); }
      return;
    }
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
    const modifier = event.ctrlKey || event.metaKey;
    if (event.key === "Enter" && event.shiftKey && modifier && onStop && !event.repeat) { if (followUps.sendNext()) { event.preventDefault(); return true; } }
    if (event.key !== "Enter" || event.shiftKey) return false;
    event.preventDefault();
    followUps.choose(modifier);
    if ((canSend || followUps.canFollowUp || commands.isCommand) && !event.repeat) form.current?.requestSubmit();
    return true;
  }
  const menu = commands.open ? { id: commands.listId, active: commands.activeId } : mentions.open ? { id: mentions.listId, active: mentions.activeId } : null;

  return (
    <form ref={form} className="composer" data-image-drag={dragging || undefined} data-resting={resting || undefined} aria-label="Message composer" aria-busy={sending || commands.launching || Boolean(onStop)} onSubmit={submit}
      // Using the composer brings it back from resting; the model controls moved under it, and its buttons, do not.
      onFocusCapture={event => { if (form.current?.contains(event.target as Node)) restingState?.focused(); }}
      onPointerDown={event => {
        const target = event.target as Element;
        if (!resting || !form.current?.contains(target)) return;
        // Its buttons keep focus where it is, so the composer stays resting.
        if (target.closest(".composer-actions")) { event.preventDefault(); return; }
        if (target.closest("button, a, input, select, [role=button], [role=menuitem]")) return;
        restingState?.expand();
        if (!target.closest(".composer__input")) { event.preventDefault(); requestAnimationFrame(() => editor.current?.focus()); }
      }}
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
      {resting && !pendingSend && <RestingImageCount count={attachments.images.length} onExpand={() => { restingState?.expand(); editor.current?.focus(); }} />}
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
        {resting && restingState?.host ? createPortal(<div className="composer-resting-controls"><ComposerSettings /></div>, restingState.host) : <ComposerSettings />}
        <ComposerActions canQueue={followUps.canFollowUp} queueLabel={followUps.label} canSend={commands.isCommand ? !readOnly && !sending && !commands.launching : canSend} sending={sending} connected={Boolean(onSend)} saveOnly={saveOnly} onStop={sending ? () => { sendController.current?.abort(); onStop?.(); } : onStop} stopLabel={sending ? "Stop sending" : stopLabel} onAttach={canAttach ? () => picker.current?.click() : undefined} />
      </div>
    </form>
  );
}
