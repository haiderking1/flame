import { useLayoutEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import "./session-menu.css";

export function SessionMenu({ id, x, y, trigger, settled, onSettle, onClose, onRename, onDelete }: {
  id: string; x: number; y: number; trigger: RefObject<HTMLButtonElement | null>; settled: boolean; onSettle(): void; onClose(restoreFocus: boolean): void; onRename(): void; onDelete(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current!;
    const bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - bounds.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - bounds.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!element.contains(target) && !trigger.current?.contains(target)) onClose(false);
    };
    const repositioned = (event: Event) => { if (!element.contains(event.target as Node)) onClose(false); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", repositioned);
    document.addEventListener("scroll", repositioned, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", repositioned);
      document.removeEventListener("scroll", repositioned, true);
    };
  }, []);
  return createPortal(<div id={id} ref={menu} className="session-menu" role="menu" aria-label="Thread options"
    onBlur={event => {
      const target = event.relatedTarget as Node | null;
      if (target && !event.currentTarget.contains(target) && !trigger.current?.contains(target)) onClose(false);
    }}
    onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") event.preventDefault();
        onClose(true); return;
      }
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index + items.length - 1) % items.length : null;
      if (next !== null) { event.preventDefault(); items[next]?.focus({ preventScroll: true }); }
    }}>
    <button role="menuitem" type="button" onClick={() => { onClose(true); onRename(); }}>Rename</button>
    <button role="menuitem" type="button" onClick={() => { onClose(true); onSettle(); }}>{settled ? "Unsettle" : "Settle"}</button>
    <div className="session-menu__separator" role="separator" />
    <button role="menuitem" type="button" className="session-menu__delete" onClick={() => { onClose(true); onDelete(); }}>Delete</button>
  </div>, document.body);
}
