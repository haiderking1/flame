import { EventEmitter } from "node:events";
/**
 * Per-project revision that advances whenever an agent tool may have changed files on disk.
 * Revisions are in-memory hints for clients to recheck Git status; they never claim what changed.
 */
export class WorkspaceChanges extends EventEmitter {
  private readonly revisions = new Map<string, number>();
  revision(projectId: string) { return this.revisions.get(projectId) ?? 0; }
  touch(projectId: string) {
    const next = this.revision(projectId) + 1;
    this.revisions.set(projectId, next);
    this.emit("change", projectId, next);
  }
}
