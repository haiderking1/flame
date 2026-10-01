import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAtomSet } from "@effect/atom-react";
import { gitStatus, gitErrorMessage } from "../../../backend/git";
import { gitStatusStore, type GitStatusRefresh, type GitStatusSnapshot, type GitStatusSource } from "./gitStatusStore";
const NO_PROJECT: GitStatusSnapshot = Object.freeze({ status: null, pending: false, error: null });
const noop = () => () => {};
// Reads the shared per-project status: cached results show instantly and mounting only runs a quiet check.
export function useGitStatus(projectId: string | null) {
  const read = useAtomSet(gitStatus, { mode: "promise" });
  const source = useMemo<GitStatusSource>(() => ({ read, describe: gitErrorMessage }), [read]);
  const subscribe = useCallback((listener: () => void) => projectId ? gitStatusStore.subscribe(projectId, listener) : noop(), [projectId]);
  const snapshot = useSyncExternalStore(subscribe, () => projectId ? gitStatusStore.snapshot(projectId) : NO_PROJECT);
  const refresh = useCallback((mode: GitStatusRefresh = "reload") => projectId ? gitStatusStore.refresh(projectId, source, mode) : Promise.resolve(), [projectId, source]);
  useEffect(() => { void refresh("check"); }, [refresh]);
  return { ...snapshot, pending: snapshot.pending || (!!projectId && !snapshot.status && !snapshot.error), refresh };
}
export type GitStatusState = ReturnType<typeof useGitStatus>;
