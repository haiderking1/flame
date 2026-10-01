import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionLocation } from "@contracts/sessions";
import { worktreeSetup } from "../../../backend/worktrees";
import { visibleSetup } from "../../composer/workspace/workspaceLogic";

/** The worktree setup the timeline shows for a session, if any. */
export function useWorktreeSetup(location: SessionLocation) {
  const result = useAtomValue(worktreeSetup(`${location.projectId}:${location.sessionId}`));
  return visibleSetup(AsyncResult.isSuccess(result) ? result.value : null);
}
