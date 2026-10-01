import { useId, useRef, type ReactNode } from "react";

/**
 * Shows a short explanation next to a control on hover or keyboard focus, used for disabled actions.
 * The hint is a manual popover anchored to the wrapper, so it escapes clipping by menus and headers.
 */
export function HoverHint({ hint, side, className, children }: { hint: string | null; side: "bottom" | "left"; className?: string; children: ReactNode }) {
  const id = useId(), anchor = `--hint-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`, popover = useRef<HTMLDivElement>(null);
  if (!hint) return <>{children}</>;
  const show = () => { try { popover.current?.showPopover(); } catch { /* Already open or detached. */ } };
  const hide = () => { try { popover.current?.hidePopover(); } catch { /* Already closed. */ } };
  return <span className={className ?? "git-hint__anchor"} style={{ anchorName: anchor }} aria-describedby={id}
    onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
    {children}
    <div id={id} ref={popover} popover="manual" role="tooltip" className={`git-hint git-hint--${side}`} style={{ positionAnchor: anchor }}>{hint}</div>
  </span>;
}
