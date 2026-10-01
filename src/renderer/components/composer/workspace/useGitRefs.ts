import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { GitRefList } from "@contracts/worktrees";
import { gitChanges } from "../../../backend/git";
import { gitRefs, worktreeErrorMessage } from "../../../backend/worktrees";
import type { WorkspaceKey } from "../../../backend/workspaceKey";

export type RefsState = { list: GitRefList | null; loading: boolean; error: string | null };
const LIMIT = 100;
/**
 * Branches of a workspace's repository for the branch picker, reloaded when Flame changes its files or branch, or when
 * `branch` (the checked-out branch from the shared Git status, refreshed on focus) shows it changed outside Flame.
 */
export function useGitRefs(workspace: WorkspaceKey, branch: string | null) {
  const read = useAtomSet(gitRefs, { mode: "promise" });
  const changes = useAtomValue(gitChanges(workspace));
  const revision = AsyncResult.isSuccess(changes) ? changes.value : 0;
  const [state, setState] = useState<RefsState>({ list: null, loading: true, error: null });
  const query = useRef(""), sequence = useRef(0);
  const load = useCallback((next = query.current) => {
    query.current = next;
    const current = ++sequence.current;
    setState(old => ({ ...old, loading: true, error: null }));
    return read({ workspace, query: next, limit: LIMIT }).then(
      list => { if (current === sequence.current) setState({ list, loading: false, error: null }); },
      error => { if (current === sequence.current) setState(old => ({ ...old, loading: false, error: worktreeErrorMessage(error, "Branches could not be listed.") })); },
    );
  }, [read, workspace]);
  useEffect(() => { query.current = ""; setState({ list: null, loading: true, error: null }); }, [workspace]);
  useEffect(() => { void load(); }, [load, revision, branch]);
  return { ...state, search: (next: string) => { if (next !== query.current) void load(next); }, reload: () => load() };
}
