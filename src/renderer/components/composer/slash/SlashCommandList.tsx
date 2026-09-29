import type { RefObject } from "react";
import { createPortal } from "react-dom";
import type { SlashCommand } from "./commands";
import { useSlashMenuPosition } from "./useSlashMenuPosition";
import "./slash-command-list.css";

export function SlashCommandList({ id, input, commands, selectedIndex, unavailable, onExecute, onHighlight }: {
  id: string; input: RefObject<HTMLTextAreaElement | null>; commands: readonly SlashCommand[]; selectedIndex: number;
  unavailable: string | null; onExecute(command: SlashCommand): void; onHighlight(index: number): void;
}) {
  const position = useSlashMenuPosition(input);
  if (!position) return null;
  return createPortal(<div className="slash-commands-layer" style={position}>
    <div className="slash-commands">
    <div id={id} role="listbox" aria-label="Slash commands" className="slash-commands__list flame-scrollbar">
      {commands.map((command, index) => <div key={command.id} id={`${id}-${command.id}`} role="option"
        aria-selected={index === selectedIndex} aria-disabled={!!unavailable} title={unavailable ?? command.description} className="slash-commands__option"
        onPointerDown={event => event.preventDefault()} onPointerMove={() => onHighlight(index)} onClick={() => onExecute(command)}>
        <span className="slash-commands__name">{command.text}</span>
        <span className="slash-commands__description">{command.description}</span>
      </div>)}
    </div>
    {commands.length === 0 && <p className="slash-commands__empty" role="status">No matching slash command.</p>}
    <p id={`${id}-hint`} className="slash-commands__hint">Enter to run · Tab to complete · Esc to dismiss</p>
    </div>
  </div>, document.body);
}
