import { useEffect, useId, useRef, type ReactNode } from "react";
import "./session-dialog.css";
export function SessionDialog({ title, busy, error, onClose, onSubmit, action, destructive = false, children }: {
  title: string; busy: boolean; error: string | null; onClose(): void; onSubmit(): void; action: string; destructive?: boolean; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    dialog.current?.showModal();
    if (destructive) cancel.current?.focus();
    else dialog.current?.querySelector<HTMLElement>("input,select")?.focus();
    return () => dialog.current?.close();
  }, []);
  return <dialog ref={dialog} className="session-dialog" aria-labelledby={id} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy) onSubmit(); }}>
      <h2 id={id}>{title}</h2>{children}
      {error && <p role="alert">{error}</p>}
      <div className="session-dialog__actions">
        <button ref={cancel} type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy} data-destructive={destructive || undefined}>{busy ? "Saving…" : action}</button>
      </div>
    </form>
  </dialog>;
}
