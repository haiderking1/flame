import type { WorkspaceKey } from "../../../backend/workspaceKey";
import { useEffect, useId, useState, type RefObject } from "react";
import type { WorkspaceEntry } from "@contracts/workspace-search";
import type { PromptEditorHandle } from "../editor/PromptEditor";
import { detectMentionTrigger } from "./mentionText";
import { usePathSearch } from "./usePathSearch";

/**
 * The `@` file menu: finds the mention token at the caret, searches the project for it, and turns the chosen
 * entry into a chip. Escape hides the menu until the caret leaves that token.
 */
export function useFileMentions({ workspace, text, cursor, focused, blocked, editor }: {
  workspace: WorkspaceKey | null; text: string; cursor: number | null; focused: boolean; blocked: boolean; editor: RefObject<PromptEditorHandle | null>;
}) {
  const listId = useId();
  const trigger = cursor === null ? null : detectMentionTrigger(text, cursor);
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => { if (!trigger && dismissed !== null) setDismissed(null); }, [trigger, dismissed]);
  const open = !!trigger && !!workspace && focused && !blocked && dismissed !== trigger.start;
  const query = open ? trigger.query.trim() : "";
  const search = usePathSearch(open ? workspace : null, open ? query : null);
  const items = query ? search.entries : [];
  const [highlight, setHighlight] = useState({ query: "", index: 0 });
  const index = highlight.query === query.toLowerCase() ? Math.min(highlight.index, Math.max(0, items.length - 1)) : 0;
  const status = !query ? "Type to search files and folders."
    : search.error ?? (items.length ? null : search.pending ? "Searching workspace files…" : "No matching files or folders.");
  function select(entry: WorkspaceEntry | undefined = items[index]) {
    if (!trigger || !entry) return false;
    const inserted = editor.current?.insertMention({ start: trigger.start, end: trigger.end, expected: text.slice(trigger.start, trigger.end) }, entry.path, entry.kind === "directory");
    setHighlight({ query: "", index: 0 });
    return !!inserted;
  }
  function handleKeyDown(event: KeyboardEvent): boolean {
    if (!open) return false;
    if (event.key === "Escape") { event.preventDefault(); setDismissed(trigger!.start); return true; }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      setHighlight({ query: query.toLowerCase(), index: (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length });
      return true;
    }
    if (((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) && items.length) {
      event.preventDefault(); select(); return true;
    }
    return false;
  }
  return {
    open, listId, items, index, status, pending: search.pending,
    activeId: open && items[index] ? `${listId}-${index}` : undefined,
    highlight: (next: number) => setHighlight(previous => previous.query === query.toLowerCase() && previous.index === next ? previous : { query: query.toLowerCase(), index: next }),
    select, handleKeyDown,
  };
}
