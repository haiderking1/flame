import { useEffect, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { WorkspaceSearchResult } from "@contracts/workspace-search";
import type { WorkspaceKey } from "../../../backend/workspaceKey";
import { searchWorkspace, workspaceSearchMessage } from "../../../backend/workspaceSearch";

export const PATH_SEARCH_LIMIT = 80;
const DEBOUNCE_MS = 120, CACHE_TTL_MS = 15_000, CACHE_SIZE = 64;
// Recent results per project and query, so retyping or backspacing reuses them for a few seconds.
const cache = new Map<string, { result: WorkspaceSearchResult; at: number }>();
function remember(key: string, result: WorkspaceSearchResult) {
  cache.delete(key); cache.set(key, { result, at: Date.now() });
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}
const fresh = (key: string) => { const hit = cache.get(key); return hit && Date.now() - hit.at < CACHE_TTL_MS ? hit.result : null; };
type State = { key: string; result: WorkspaceSearchResult | null; error: string | null };

/** Debounced file search of the workspace (project checkout or session worktree) for `@` mentions. An empty query does not search. */
export function usePathSearch(workspace: WorkspaceKey | null, query: string | null) {
  const search = useAtomSet(searchWorkspace, { mode: "promise" });
  const target = workspace && query?.trim() ? `${workspace}\0${query.trim()}` : null;
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!target || !workspace) return;
    const cached = fresh(target);
    if (cached) { setState({ key: target, result: cached, error: null }); return; }
    let alive = true;
    const timer = setTimeout(() => {
      search({ workspace, query: target.slice(target.indexOf("\0") + 1), limit: PATH_SEARCH_LIMIT }).then(
        result => { remember(target, result); if (alive) setState({ key: target, result, error: null }); },
        error => { if (alive) setState({ key: target, result: null, error: workspaceSearchMessage(error) }); },
      );
    }, DEBOUNCE_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [target, workspace, search]);
  const current = state?.key === target ? state : null;
  // While a new query loads, keep showing the previous results instead of flashing an empty list.
  return { entries: (current?.result ?? state?.result)?.entries ?? [], pending: !!target && !current, error: current?.error ?? null, searched: !!target };
}
