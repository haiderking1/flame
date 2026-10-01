import { useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionEntry } from "@contracts/sessions";
import { downloadImage } from "../../backend/images";
import { sessionErrorMessage } from "../../backend/sessions";
import { followUpScope, followUpStore } from "../composer/followUps/followUpStore";
import { GitDialogFrame } from "../workspace/git/GitDialogFrame";
import { useSessions } from "./SessionContext";
import "./edit-from-here.css";

/**
 * T3 Code's "Edit from here?": rewinds the thread to before a message and puts the message and its attachments back in
 * the composer. A thread in its own worktree can also put its files back as they were before the message.
 */
export default function EditFromHereDialog({ entry, worktree, onClose }: { entry: SessionEntry; worktree: boolean; onClose(): void }) {
  const sessions = useSessions()!;
  const download = useAtomSet(downloadImage("edit-from-here"), { mode: "promise" });
  const [busy, setBusy] = useState<"files" | "keep" | null>(null), [error, setError] = useState<string | null>(null);
  const location = sessions.document;
  async function confirm(restoreFiles: boolean) {
    if (!location || busy) return;
    if (sessions.running) { setError("Interrupt the current turn before reverting checkpoints."); return; }
    setBusy(restoreFiles ? "files" : "keep"); setError(null);
    try {
      // The attachments are copied first: once the message is rewound they may no longer be kept.
      const images = await Promise.all((entry.images ?? []).map(async image => {
        try { return { id: crypto.randomUUID(), name: image.name, file: await download({ projectId: location.projectId, sessionId: location.sessionId, image }) }; }
        catch { throw new Error(`Could not restore attachment: ${image.name}`); }
      }));
      await sessions.rewind(entry.id, restoreFiles);
      followUpStore.restore(followUpScope(location), { text: entry.text ?? "", images });
      onClose();
    } catch (failure) { setError(failure instanceof Error && failure.message.startsWith("Could not restore attachment") ? failure.message : sessionErrorMessage(failure)); }
    finally { setBusy(null); }
  }
  return <GitDialogFrame className="edit-from-here" title="Edit from here?" locked={!!busy} onClose={onClose}
    description={`Rewind chat to before this message. Your prompt and attachments return to the composer.${worktree ? "" : " Files stay as they are because this thread shares the project directory."}`}
    footer={<>
      <button type="button" className="git-button git-button--outline" disabled={!!busy} onClick={onClose}>Cancel</button>
      {worktree && <button type="button" className="git-button git-button--outline edit-from-here__destructive" disabled={!!busy} onClick={() => { void confirm(true); }}>{busy === "files" ? "Reverting…" : "Revert files too"}</button>}
      <button type="button" className="git-button git-button--primary" disabled={!!busy} onClick={() => { void confirm(false); }}>{busy === "keep" ? "Reverting…" : "Revert and keep changes"}</button>
    </>}>
    {error && <p className="edit-from-here__error" role="alert">{error}</p>}
  </GitDialogFrame>;
}
