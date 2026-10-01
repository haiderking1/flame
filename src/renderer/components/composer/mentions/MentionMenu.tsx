import { useLayoutEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceEntry } from "@contracts/workspace-search";
import { FileIcon } from "../../files/FileIcon";
import { useSlashMenuPosition } from "../slash/useSlashMenuPosition";
import "../slash/slash-command-list.css";
import "./mention-menu.css";

/** Project files and folders matching the `@` query, drawn above the composer like the slash menu. */
export function MentionMenu({ id, anchor, items, selectedIndex, status, pending, onSelect, onHighlight }: {
  id: string; anchor: RefObject<HTMLElement | null>; items: readonly WorkspaceEntry[]; selectedIndex: number; status: string | null; pending: boolean;
  onSelect(entry: WorkspaceEntry): void; onHighlight(index: number): void;
}) {
  const position = useSlashMenuPosition(anchor);
  useLayoutEffect(() => { document.getElementById(`${id}-${selectedIndex}`)?.scrollIntoView({ block: "nearest" }); }, [id, selectedIndex, items]);
  if (!position) return null;
  return createPortal(<div className="slash-commands-layer" style={position}>
    <div className="slash-commands mention-menu" aria-busy={pending || undefined}>
      <div id={id} role="listbox" aria-label="Files and folders" className="slash-commands__list flame-scrollbar">
        {items.map((entry, index) => {
          const separator = entry.path.lastIndexOf("/");
          return <div key={`${entry.kind}:${entry.path}`} id={`${id}-${index}`} role="option" aria-selected={index === selectedIndex} title={entry.path}
            className="slash-commands__option mention-menu__option" data-kind={entry.kind}
            onPointerDown={event => event.preventDefault()} onPointerMove={() => onHighlight(index)} onClick={() => onSelect(entry)}>
            <FileIcon path={entry.path} directory={entry.kind === "directory"} />
            <span className="slash-commands__name">{entry.path.slice(separator + 1)}</span>
            {separator > 0 && <span className="slash-commands__description">{entry.path.slice(0, separator)}</span>}
          </div>;
        })}
      </div>
      {status && <p className="slash-commands__empty" role="status">{status}</p>}
      <p id={`${id}-hint`} className="slash-commands__hint">Enter or Tab to mention · Esc to dismiss</p>
    </div>
  </div>, document.body);
}
