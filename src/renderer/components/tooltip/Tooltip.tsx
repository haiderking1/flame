import { useEffect, useId, useRef, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import "./tooltip.css";

// After one tooltip closes, the next opens at once for this long, as Base UI's tooltip groups do in T3 Code.
const GROUP_TIMEOUT_MS = 400;
let lastClosedAt = 0;

/**
 * T3 Code's hover tooltip: a small label above the element after a short hover. It never takes focus or clicks, and
 * lives outside the element, so it adds nothing to the element's text.
 */
export function Tooltip({ label, delay = 600, children, ...props }: HTMLAttributes<HTMLSpanElement> & { label: string; delay?: number }) {
  const id = useId();
  // useId output is not a valid dashed ident as-is.
  const anchor = `--tooltip-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const popup = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const open = () => { try { popup.current?.showPopover(); } catch { /* Already open, or gone. */ } };
  const show = () => {
    window.clearTimeout(timer.current);
    if (Date.now() - lastClosedAt < GROUP_TIMEOUT_MS) open();
    else timer.current = window.setTimeout(open, delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    if (!popup.current?.matches(":popover-open")) return;
    try { popup.current.hidePopover(); } catch { /* Already closed. */ }
    lastClosedAt = Date.now();
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("keydown", escape, true);
    return () => { window.clearTimeout(timer.current); document.removeEventListener("keydown", escape, true); };
  }, []);
  return <span {...props} style={{ ...props.style, anchorName: anchor }} aria-describedby={id} onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide}>
    {children}
    {createPortal(<span ref={popup} id={id} popover="manual" role="tooltip" className="tooltip" style={{ positionAnchor: anchor }}>{label}</span>, document.body)}
  </span>;
}
