import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { LOCAL_WORKSPACE, type SessionWorkspace } from "@contracts/session-workspace";
import { projectSettings, type WorktreeSettings } from "@contracts/worktrees";
import { worktreeSettingsAtom } from "../../../backend/worktrees";

/** Where a new session works by default, from the project's worktree settings. */
export function defaultWorkspace(settings: WorktreeSettings | null, projectId: string): SessionWorkspace {
  const resolved = settings ? projectSettings(settings, projectId) : null;
  return resolved?.defaultMode === "worktree" ? { mode: "worktree", baseBranch: null, startFromOrigin: resolved.startFromOrigin, branch: null, worktreePath: null } : LOCAL_WORKSPACE;
}
export function useWorktreeSettings() {
  const result = useAtomValue(worktreeSettingsAtom);
  return AsyncResult.isSuccess(result) ? result.value : null;
}
