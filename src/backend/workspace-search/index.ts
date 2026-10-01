import { FileFinder } from "@ff-labs/fff-node";
import { WorkspaceSearchError, type WorkspaceSearchResult } from "../../contracts/workspace-search.js";
import { mapMixedResult } from "./results.js";

export const INDEX_SCAN_TIMEOUT_MS = 15_000;
const indexing = () => new WorkspaceSearchError({ code: "INDEXING", message: "Flame is still indexing this project's files. Try again in a moment." });
const unavailable = () => new WorkspaceSearchError({ code: "UNAVAILABLE", message: "File search is unavailable for this project right now." });

/**
 * One project's fff path index (no content index). fff scans in the background and watches the folder,
 * respecting .gitignore; the first search waits for the scan, and a slow scan keeps going for the next one.
 */
export class WorkspaceIndex {
  private ready: Promise<boolean>;
  private constructor(readonly root: string, private readonly finder: FileFinder) {
    this.ready = this.waitForReady();
  }
  static open(root: string) {
    let created: ReturnType<typeof FileFinder.create>;
    try {
      created = FileFinder.create({ basePath: root, disableMmapCache: true, disableContentIndexing: true, aiMode: false,
        enableFsRootScanning: true, enableHomeDirScanning: true });
    } catch { throw unavailable(); }
    if (!created.ok) throw unavailable();
    return new WorkspaceIndex(root, created.value);
  }
  async search(query: string, limit: number): Promise<WorkspaceSearchResult> {
    if (!await this.ready) {
      // The scan continues in the background; the next search waits for it again.
      this.ready = this.waitForReady();
      throw indexing();
    }
    let result: ReturnType<FileFinder["mixedSearch"]>;
    try { result = this.finder.mixedSearch(query, { pageSize: limit + 1 }); } catch { throw unavailable(); }
    if (!result.ok) throw unavailable();
    return mapMixedResult(result.value, limit);
  }
  /** Rescans after Flame changed files, catching anything the watcher missed. */
  async rescan() {
    const started = this.finder.scanFiles();
    if (!started.ok) throw unavailable();
    this.ready = this.waitForReady();
    if (!await this.ready) throw indexing();
  }
  destroy() { if (!this.finder.isDestroyed) this.finder.destroy(); }
  private async waitForReady() {
    try { const result = await this.finder.waitForIndexReady(INDEX_SCAN_TIMEOUT_MS); return result.ok && result.value; }
    catch { return false; }
  }
}
