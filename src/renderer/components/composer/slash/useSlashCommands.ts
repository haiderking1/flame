import { useId, useRef, useState, type RefObject } from "react";
import type { PromptEditorHandle } from "../editor/PromptEditor";
import { sessionErrorMessage } from "../../../backend/sessions";
import { useSessions } from "../../sessions/SessionContext";
import { matchingCommands, slashQuery, type SlashCommand } from "./commands";

export function useSlashCommands({ draft, setDraft, readOnly, input, onError }: {
  draft: string; setDraft(value: string): void; readOnly: boolean;
  input: RefObject<PromptEditorHandle | null>; onError(message: string | null): void;
}) {
  const sessions = useSessions();
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [selection, setSelection] = useState({ query: "", index: 0 });
  const [launching, setLaunching] = useState(false);
  const inFlight = useRef(false);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const query = slashQuery(draft);
  const matches = query === null ? [] : matchingCommands(query);
  const index = selection.query === query ? Math.min(selection.index, Math.max(0, matches.length - 1)) : 0;
  const selected = matches[index];
  const open = focused && !readOnly && !launching && query !== null && dismissed !== draft;
  const hasConversation = !!sessions?.page.nextBefore || !!sessions?.page.entries.some(entry => entry.kind === "user" || entry.kind === "assistant");
  const unavailable = !sessions?.document ? "Open a conversation before compacting."
    : !sessions.document.settings ? "Choose a model before compacting."
    : !sessions.accountKey ? "Connect a provider before compacting."
    : !hasConversation ? "Send a message before compacting."
    : sessions.running ? "Stop the active response before compacting."
    : sessions.transitioning ? "Wait for conversation navigation to finish before compacting." : null;

  async function execute(command = selected) {
    if (inFlight.current || readOnly) return;
    if (!command) { onError("No matching slash command."); return; }
    if (unavailable || !sessions) { onError(unavailable); return; }
    const submitted = draft;
    inFlight.current = true; setLaunching(true); onError(null);
    let accepted = false;
    try {
      const saved = await sessions.compact();
      if (!saved) throw new Error("Compaction could not start. Try again.");
      accepted = true;
      // Consume only the command that was accepted, never a newer draft or attachments.
      if (input.current && latestDraft.current === submitted) {
        setDraft("");
        await sessions.flushDraft();
      }
    } catch (error) {
      onError(accepted ? "Compaction started, but its command draft could not be saved. Retry saving the draft." : sessionErrorMessage(error));
    } finally {
      inFlight.current = false; setLaunching(false); input.current?.focus();
    }
  }
  function complete(command: SlashCommand) {
    setDraft(command.text); setDismissed(null); onError(null);
  }
  function handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === "Escape" && open) {
      event.preventDefault(); setDismissed(draft); return true;
    }
    if (event.key === "Tab" && !event.shiftKey && open && selected) {
      event.preventDefault(); complete(selected); return true;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && open && matches.length > 0) {
      event.preventDefault();
      setSelection({ query: query!, index: (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length });
      return true;
    }
    return false;
  }
  return { listId, matches, index, open, unavailable, launching, isCommand: query !== null,
    activeId: open && selected ? `${listId}-${selected.id}` : undefined,
    highlight: (index: number) => {
      if (query !== null) setSelection(previous => previous.query === query && previous.index === index ? previous : { query, index });
    },
    execute, handleKeyDown, onFocus: () => setFocused(true), onBlur: () => setFocused(false),
    onChange: (value: string) => { setDismissed(null); setSelection({ query: "", index: 0 }); setDraft(value); onError(null); } };
}
