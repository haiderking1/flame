import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAtomSet } from "@effect/atom-react";
import { gitStatus, gitErrorMessage } from "../../../backend/git";
import type { WorkspaceKey } from "../../../backend/workspaceKey";
import { gitStatusStore, type GitStatusRefresh, type GitStatusSnapshot, type GitStatusSource } from "./gitStatusStore";
const NO_WORKSPACE: GitStatusSnapshot = Object.freeze({ status: null, pending: false, error: null });
const noop = () => () => {};
// Reads the shared per-workspace status: cached results show instantly and mounting only runs a quiet check.
export function useGitStatus(workspace: WorkspaceKey | null) {
  const read = useAtomSet(gitStatus, { mode: "promise" });
  const source = useMemo<GitStatusSource>(() => ({ read, describe: gitErrorMessage }), [read]);
  const subscribe = useCallback((listener: () => void) => workspace ? gitStatusStore.subscribe(workspace, listener) : noop(), [workspace]);
  const snapshot = useSyncExternalStore(subscribe, () => workspace ? gitStatusStore.snapshot(workspace) : NO_WORKSPACE);
  const refresh = useCallback((mode: GitStatusRefresh = "reload") => workspace ? gitStatusStore.refresh(workspace, source, mode) : Promise.resolve(), [workspace, source]);
  useEffect(() => { void refresh("check"); }, [refresh]);
  return { ...snapshot, pending: snapshot.pending || (!!workspace && !snapshot.status && !snapshot.error), refresh };
}
export type GitStatusState = ReturnType<typeof useGitStatus>;
