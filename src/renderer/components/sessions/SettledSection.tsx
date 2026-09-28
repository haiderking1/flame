import { useId, useState, type ReactNode } from "react";
import "./settled-section.css";

export function SettledSection({ count, searching, children }: { count: number; searching: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const open = expanded || searching;
  return <section className="settled-section" aria-label="Settled threads">
    <button className="settled-section__toggle" type="button" aria-expanded={open} aria-controls={id}
      disabled={searching} onClick={() => setExpanded(value => !value)}>
      <span>Settled{(!open || count === 0) && ` (${count})`}</span>
      <span className="settled-section__divider" aria-hidden="true" />
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} hidden={!open}>{children}</div>
  </section>;
}
