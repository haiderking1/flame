import { useRef, useState } from "react";
import type { SessionSummary } from "@contracts/sessions";
import { sessionErrorMessage } from "../../backend/sessions";
import { useSessions } from "./SessionContext";
import { SessionDialog } from "./SessionDialog";

export function DeleteSessionDialog({ session, onClose }: { session: SessionSummary; onClose(): void }) {
  const workspace = useSessions()!;
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await workspace.deleteSession(session); onClose(); }
    catch (error) { setError(sessionErrorMessage(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <SessionDialog title="Delete thread?" action="Delete" destructive busy={busy} error={error} onClose={onClose} onSubmit={() => { void remove(); }}>
    <p>Delete “{session.title}” and its saved conversation? This cannot be undone in the app.</p>
  </SessionDialog>;
}
