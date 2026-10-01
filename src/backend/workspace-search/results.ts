import type { MixedSearchResult } from "@ff-labs/fff-node";
import type { WorkspaceEntry, WorkspaceSearchResult } from "../../contracts/workspace-search.js";

/** Trims, drops the `@`, `./` and `/` people type before paths, and lowercases, as T3 Code does. */
export function normalizeSearchQuery(query: string) {
  return query.trim().replace(/^[@./]+/, "").toLowerCase();
}
/** Maps fff's interleaved file and folder matches to project-relative POSIX entries, without the project root itself. */
export function mapMixedResult(result: MixedSearchResult, limit: number): WorkspaceSearchResult {
  const entries: WorkspaceEntry[] = [];
  for (const { type, item } of result.items) {
    const path = item.relativePath.replaceAll("\\", "/").replace(/\/+$/, "");
    if (path) entries.push({ path, kind: type });
    if (entries.length >= limit) break;
  }
  const root = result.items.some(({ type, item }) => type === "directory" && !item.relativePath.replace(/[\\/]+$/, "")) ? 1 : 0;
  return { entries, truncated: result.totalMatched - root > limit };
}
