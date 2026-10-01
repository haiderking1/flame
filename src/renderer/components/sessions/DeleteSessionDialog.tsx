import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionSummary } from "@contracts/sessions";
import { projectSettings } from "@contracts/worktrees";
import { sessionErrorMessage, sessionsAtom } from "../../backend/sessions";
import { removeWorktree, worktreeErrorMessage } from "../../backend/worktrees";
import { folderName, orphanedWorktree } from "../composer/workspace/workspaceLogic";
import { useWorktreeSettings } from "../composer/workspace/worktreeDefaults";
import { toastStore } from "../toasts/toastStore";
import { useSessions } from "./SessionContext";
import { SessionDialog } from "./SessionDialog";

/**
 * Confirms deleting a session. When it is the only session using its worktree, and cleanup does not already remove
 * worktrees of deleted sessions, it then asks whether to delete the worktree too, as T3 Code does.
 */
export function DeleteSessionDialog({ session, onClose }: { session: SessionSummary; onClose(): void }) {
  const workspace = useSessions()!;
  const index = useAtomValue(sessionsAtom), settings = useWorktreeSettings();
  const removeFolder = useAtomSet(removeWorktree, { mode: "promise" });
  const [busy, setBusy] = useState(false), [step, setStep] = useState<"session" | "worktree">("session");
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const orphan = orphanedWorktree(session, AsyncResult.isSuccess(index) ? index.value.sessions : []);
  const automatic = settings ? projectSettings(settings, session.projectId).cleanup.onDelete : false;
  async function remove(withWorktree: boolean) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await workspace.deleteSession(session); onClose(); }
    catch (error) { setError(sessionErrorMessage(error)); return; }
    finally { pending.current = false; setBusy(false); }
    if (!withWorktree || !orphan) return;
    try { await removeFolder({ projectId: session.projectId, path: orphan }); }
    catch (failure) {
      const detail = `Could not remove ${orphan}. ${worktreeErrorMessage(failure)}`;
      toastStore.show({ id: `worktree-remove:${orphan}`, scope: session.projectId, type: "error", title: "Failed to delete worktree", description: detail, copy: detail });
    }
  }
  if (step === "worktree") return <SessionDialog title="Delete worktree too?" action="Delete worktree" cancelLabel="Keep worktree" destructive busy={busy} error={error}
    onClose={() => { void remove(false); }} onSubmit={() => { void remove(true); }}>
    <p>This thread is the only one linked to this worktree:</p>
    <p className="session-dialog__path" title={orphan ?? undefined}>{orphan && folderName(orphan)}</p>
    <p>Delete the worktree too?</p>
  </SessionDialog>;
  return <SessionDialog title="Delete thread?" action="Delete" destructive busy={busy} error={error} onClose={onClose}
    onSubmit={() => { if (orphan && !automatic) setStep("worktree"); else void remove(false); }}>
    <p>Delete “{session.title}” and its saved conversation? This cannot be undone in the app.</p>
  </SessionDialog>;
}
