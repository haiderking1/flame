import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionSummary } from "@contracts/sessions";
import { sessionsAtom } from "../../backend/sessions";
import { workspaceKey, worktreeKey, type WorkspaceKey } from "../../backend/workspaceKey";
import { useSessions } from "../sessions/SessionContext";

/** The open session's index entry, which carries where it works and is updated as its worktree is created or renamed. */
export function useSessionSummary(location: { projectId: string; sessionId: string } | null | undefined): SessionSummary | null {
  const index = useAtomValue(sessionsAtom);
  if (!location || !AsyncResult.isSuccess(index)) return null;
  return index.value.sessions.find(session => session.projectId === location.projectId && session.sessionId === location.sessionId) ?? null;
}
/**
 * The folder Git, the diff and file search follow: the open session's worktree once it has one, the existing worktree a
 * new session in the composer has chosen, otherwise the project's checkout.
 */
export function useActiveWorkspace(): { projectId: string | null; key: WorkspaceKey | null; summary: SessionSummary | null } {
  const sessions = useSessions();
  const document = sessions?.document ?? null;
  const summary = useSessionSummary(document);
  const projectId = document?.projectId ?? sessions?.projectDraftId ?? sessions?.projectScope ?? null;
  const worktree = (summary?.workspace ?? document?.workspace)?.worktreePath ? document!.sessionId : null;
  const draftWorktree = !document && sessions?.projectDraftId ? sessions.draftWorkspace?.worktreePath ?? null : null;
  return { projectId, key: !projectId ? null : draftWorktree ? worktreeKey(projectId, draftWorktree) : workspaceKey(projectId, worktree), summary };
}
