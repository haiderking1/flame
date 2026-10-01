import { useEffect, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import { switchGitRef, worktreeErrorMessage } from "../../../backend/worktrees";
import { workspaceKey } from "../../../backend/workspaceKey";
import { useSessions } from "../../sessions/SessionContext";
import { toastStore } from "../../toasts/toastStore";
import { useGitStatus } from "../../workspace/git/useGitStatus";
import { WorkspaceIcon } from "../../workspace/WorkspaceIcon";
import { useComposerWorkspace } from "./useComposerWorkspace";
import { branchMismatch, mismatchKey, showMismatch } from "./workspaceLogic";
import "./branch-mismatch-banner.css";

// Dismissals last for this window's lifetime, as in T3 Code; they are never saved.
const dismissed = new Set<string>();
/** Above the composer: this thread last ran on another branch than the project checkout has now, with a way back. */
export function BranchMismatchBanner() {
  const state = useComposerWorkspace(), sessions = useSessions();
  const session = state.session;
  if (!state.projectId || !session || state.workspace.mode !== "local" || !state.workspace.branch) return null;
  return <Banner projectId={state.projectId} sessionId={session.sessionId} threadBranch={state.workspace.branch} hasContent={!!sessions?.draft.trim()} />;
}
function Banner({ projectId, sessionId, threadBranch, hasContent }: { projectId: string; sessionId: string; threadBranch: string; hasContent: boolean }) {
  const status = useGitStatus(workspaceKey(projectId)).status;
  const switchRef = useAtomSet(switchGitRef, { mode: "promise" });
  const [shown, setShown] = useState<string | null>(null), [restoring, setRestoring] = useState(false), [, rerender] = useState(0);
  const mismatch = branchMismatch({ mode: "local", baseBranch: null, startFromOrigin: false, branch: threadBranch, worktreePath: null }, status?.branch ?? null);
  const key = mismatch && mismatchKey(sessionId, mismatch);
  const visible = !!key && showMismatch({ dismissed: dismissed.has(key), composerHasContent: hasContent, shown: shown === key });
  useEffect(() => { setShown(previous => visible ? key : previous !== key ? null : previous); }, [key, visible]);
  if (!visible || !mismatch) return null;
  async function restore() {
    setRestoring(true);
    try { await switchRef({ workspace: workspaceKey(projectId, sessionId), ref: mismatch!.threadBranch, create: false }); }
    catch (error) { const text = worktreeErrorMessage(error); toastStore.show({ id: `branch-restore:${sessionId}`, scope: projectId, type: "error", title: "Failed to switch checkout", description: text, copy: text }); }
    finally { setRestoring(false); }
  }
  return <div className="branch-mismatch" role="status">
    <WorkspaceIcon name="branch" />
    <span className="branch-mismatch__text" title={`This thread last ran on ${mismatch.threadBranch}. Sending will continue on ${mismatch.currentBranch}.`}>
      <span>Branch changed — was</span> <code>{mismatch.threadBranch}</code>
    </span>
    <button type="button" className="branch-mismatch__restore" disabled={restoring} onClick={() => { void restore(); }}>{restoring ? "Restoring..." : "Restore branch"}</button>
    <button type="button" className="branch-mismatch__dismiss" aria-label="Dismiss branch change notice" onClick={() => { dismissed.add(key!); rerender(value => value + 1); }}><WorkspaceIcon name="close" /></button>
  </div>;
}
