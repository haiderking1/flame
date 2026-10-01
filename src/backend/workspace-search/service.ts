import { WorkspaceSearchError, type WorkspaceSearchResult } from "../../contracts/workspace-search.js";
import { WorkspaceIndex } from "./index.js";
import { normalizeSearchQuery } from "./results.js";
import type { WorkspaceTarget } from "../../contracts/workspace-target.js";

export const INDEX_IDLE_TTL_MS = 15 * 60_000;
type Entry = { index: WorkspaceIndex; timer?: ReturnType<typeof setTimeout>; refreshing: boolean; again: boolean };

/**
 * Searches a session's files for composer mentions. Each folder (project checkout or session worktree) keeps one lazily
 * created index that is released after 15 idle minutes, and is rescanned after Flame's tools change files.
 */
export class WorkspaceSearch {
  private readonly entries = new Map<string, Entry>();
  private closed = false;
  constructor(private readonly resolve: (target: WorkspaceTarget) => string,
    private readonly open: (root: string) => WorkspaceIndex = WorkspaceIndex.open, private readonly idleMs = INDEX_IDLE_TTL_MS) {}
  async search(target: WorkspaceTarget, query: string, limit: number): Promise<WorkspaceSearchResult> {
    if (this.closed) throw new WorkspaceSearchError({ code: "UNAVAILABLE", message: "File search is shutting down." });
    const entry = this.entry(this.root(target));
    return entry.index.search(normalizeSearchQuery(query), limit);
  }
  /** Rescans the folder's index if one is open; overlapping requests coalesce into one more scan. */
  refresh(root: string) {
    const entry = this.entries.get(root);
    if (!entry || this.closed) return;
    if (entry.refreshing) { entry.again = true; return; }
    entry.refreshing = true;
    void (async () => {
      try {
        do { entry.again = false; await entry.index.rescan(); } while (entry.again && this.entries.get(root) === entry);
      } catch (error) {
        // A failed rescan leaves an index that may be stale; drop it so the next search builds a fresh one.
        if (!(error instanceof WorkspaceSearchError && error.code === "INDEXING")) this.release(root, entry);
      } finally { entry.refreshing = false; }
    })();
  }
  close() {
    this.closed = true;
    for (const [root, entry] of this.entries) this.release(root, entry);
  }
  private root(target: WorkspaceTarget) {
    try { return this.resolve(target); }
    catch { throw new WorkspaceSearchError({ code: "NOT_FOUND", message: "This project is no longer available." }); }
  }
  private entry(root: string) {
    let entry = this.entries.get(root);
    if (!entry) { entry = { index: this.open(root), refreshing: false, again: false }; this.entries.set(root, entry); }
    clearTimeout(entry.timer);
    const current = entry;
    current.timer = setTimeout(() => this.release(root, current), this.idleMs);
    current.timer.unref?.();
    return current;
  }
  private release(root: string, entry: Entry) {
    clearTimeout(entry.timer);
    if (this.entries.get(root) === entry) this.entries.delete(root);
    entry.index.destroy();
  }
}
