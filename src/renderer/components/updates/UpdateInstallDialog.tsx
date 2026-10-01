import { useState } from "react";
import { SessionDialog } from "../sessions/SessionDialog";

/** Asks before Flame quits to install an update; running responses stop when it does. */
export function UpdateInstallDialog({ version, install, onClose }: { version: string; install(): Promise<boolean>; onClose(): void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true); setError(null);
    try { if (!await install()) { setError("This update is no longer ready to install. Check for updates again."); setBusy(false); } }
    catch { setError("Flame could not start the install. Try again."); setBusy(false); }
  }
  return <SessionDialog title={`Install Flame ${version}?`} busy={busy} error={error} onClose={onClose} onSubmit={() => void confirm()} action="Restart and install" busyLabel="Restarting…">
    <p>Flame restarts to install the update. Running responses are stopped, so make sure you are ready.</p>
  </SessionDialog>;
}
