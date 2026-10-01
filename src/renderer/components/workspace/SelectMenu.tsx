import { useId, useRef, useState, type KeyboardEvent } from "react";
import { WorkspaceIcon } from "./WorkspaceIcon";
import "./select-menu.css";

export type SelectOption<T extends string> = { value: T; label: string };
type Props<T extends string> = {
  value: T;
  options: readonly SelectOption<T>[];
  onChange(value: T): void;
  label: string;
  disabled?: boolean;
  triggerClassName: string;
  menuClassName?: string;
};

/** A styled single-choice dropdown: a trigger button plus a popover of radio rows, replacing the platform select. */
export function SelectMenu<T extends string>({ value, options, onChange, label, disabled, triggerClassName, menuClassName }: Props<T>) {
  const id = useId();
  // Each instance anchors its own popover; useId output is not a valid dashed ident as-is.
  const anchor = `--select-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const requestedFocus = useRef<number | null>(null);
  const selected = options.findIndex(option => option.value === value);
  function focus(index: number) {
    const list = menu.current, item = list?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[index];
    if (!list || !item) return;
    item.focus({ preventScroll: true });
    // Scroll only the menu itself; the page and any enclosing dialog stay put.
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }
  function show(index: number) {
    requestedFocus.current = index;
    menu.current?.showPopover();
    focus(index);
  }
  function close() {
    menu.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") {
      // Stop here so an enclosing panel or dialog stays open.
      event.preventDefault(); event.stopPropagation(); close();
    } else if (event.key === "Tab") close();
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      focus(next);
    }
  }
  return <>
    <button ref={trigger} type="button" className={triggerClassName} style={{ anchorName: anchor }} aria-label={label} aria-haspopup="menu" aria-controls={id} aria-expanded={open}
      popoverTarget={id} disabled={disabled}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); show(event.key === "ArrowDown" ? 0 : options.length - 1);
        }
      }}>
      <span>{options[selected]?.label ?? value}</span><WorkspaceIcon name="chevron" />
    </button>
    <div id={id} ref={menu} popover="auto" role="menu" aria-label={label} className={`select-menu flame-scrollbar${menuClassName ? ` ${menuClassName}` : ""}`} style={{ positionAnchor: anchor }}
      onToggle={event => {
        const opening = event.newState === "open";
        setOpen(opening);
        if (opening) focus(requestedFocus.current ?? Math.max(0, selected));
        requestedFocus.current = null;
      }} onKeyDown={navigate}>
      {options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} tabIndex={-1}
        onClick={() => { onChange(option.value); close(); }}>
        <span>{option.label}</span>{value === option.value && <WorkspaceIcon name="check" />}
      </button>)}
    </div>
  </>;
}
