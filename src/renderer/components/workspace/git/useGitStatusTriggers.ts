import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { gitChanges } from "../../../backend/git";
import type { WorkspaceKey } from "../../../backend/workspaceKey";
import type { GitStatusRefresh } from "./gitStatusStore";
// Agent edits arrive in bursts; one trailing read after a short quiet period covers the whole burst.
const CHANGE_SETTLE_MS = 200;
/** Quietly rechecks Git status when the window regains focus or becomes visible, or agent tools may have changed the workspace's files. Mount once per workspace. */
export function useGitStatusTriggers(workspace: WorkspaceKey, refresh: (mode: GitStatusRefresh) => Promise<void>) {
  const changes = useAtomValue(gitChanges(workspace));
  const revision = AsyncResult.isSuccess(changes) ? changes.value : null;
  const seen = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const focused = () => { void refresh("sync"); };
    const visible = () => { if (document.visibilityState === "visible") focused(); };
    window.addEventListener("focus", focused); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("focus", focused); document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  useEffect(() => {
    if (revision === null) return;
    const previous = seen.current; seen.current = revision;
    // The first value is the current revision; mounting already ran its own check.
    if (previous === null || previous === revision) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void refresh("sync"); }, CHANGE_SETTLE_MS);
  }, [revision, refresh]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
}
