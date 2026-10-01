import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { LOCAL_WORKSPACE, type SessionWorkspace } from "@contracts/session-workspace";
import { projectsAtom } from "../../../backend/projects";
import { sessionsAtom } from "../../../backend/sessions";
import { useSessions } from "../../sessions/SessionContext";
import { useActiveWorkspace } from "../../workspace/useActiveWorkspace";
import { previousWorktree } from "./workspaceLogic";
import { defaultWorkspace, useWorktreeSettings } from "./worktreeDefaults";

/**
 * Where the composer's session works and how to change it: a new session's choice lives with its draft until the first
 * message; an open session's is saved at once. The choice locks once the session has messages, as in T3 Code.
 */
export function useComposerWorkspace() {
  const sessions = useSessions();
  const { projectId, key, summary } = useActiveWorkspace();
  const settings = useWorktreeSettings();
  const index = useAtomValue(sessionsAtom), projects = useAtomValue(projectsAtom);
  const document = sessions?.document ?? null, draft = !!sessions?.projectDraftId;
  const project = projectId && AsyncResult.isSuccess(projects) ? projects.value.find(item => item.id === projectId) ?? null : null;
  const workspace: SessionWorkspace = !projectId ? LOCAL_WORKSPACE : draft ? sessions?.draftWorkspace ?? defaultWorkspace(settings, projectId)
    : summary?.workspace ?? document?.workspace ?? LOCAL_WORKSPACE;
  const hasMessages = !!document && (sessions!.page.entries.some(entry => entry.kind === "user") || !!sessions!.turn || !!sessions!.page.nextBefore);
  const all = AsyncResult.isSuccess(index) ? index.value.sessions : [];
  async function change(next: SessionWorkspace) {
    if (!sessions) return;
    if (draft) sessions.setDraftWorkspace(next);
    else if (document) await sessions.placeSession(next);
  }
  return {
    projectId, projectPath: project?.path ?? null, workspace, key, draft, session: document,
    locked: !!document && (hasMessages || !!sessions?.running), busy: !!sessions?.busy || !!sessions?.running,
    previous: projectId ? previousWorktree(all, projectId, workspace.worktreePath) : null, change,
  };
}
