import { useEffect, useRef } from "react";
import type { ResetConfirmation } from "@contracts/usage";
import "./reset-confirmation.css";

export function ResetConfirmationDialog({ confirmation, busy, onYes, onNo }: {
  confirmation: ResetConfirmation; busy: boolean; onYes(): void; onNo(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  useEffect(() => { dialog.current?.showModal(); no.current?.focus(); }, []);
  return <dialog ref={dialog} className="reset-confirmation" aria-labelledby="reset-confirmation-title" aria-describedby="reset-confirmation-description"
    onCancel={(event) => { event.preventDefault(); if (!busy) onNo(); }}
    onKeyDown={(event) => { event.stopPropagation(); }}>
    <h2 id="reset-confirmation-title">Are you sure?</h2>
    <p id="reset-confirmation-description">This will spend one banked reset. It cannot be undone.</p>
    <p className="reset-confirmation__detail">{confirmation.title}</p>
    <div className="reset-confirmation__actions">
      <button ref={no} type="button" disabled={busy} onClick={onNo}>No</button>
      <button type="button" className="reset-confirmation__yes" disabled={busy} onClick={onYes}>{busy ? "Submitting…" : "Yes"}</button>
    </div>
  </dialog>;
}
