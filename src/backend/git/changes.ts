import { EventEmitter } from "node:events";
/**
 * Per-folder revision (a project checkout or a session worktree) that advances whenever an agent tool or Git action may
 * have changed files on disk. Revisions are in-memory hints for clients to recheck Git status; they never claim what changed.
 */
export class WorkspaceChanges extends EventEmitter {
  private readonly revisions = new Map<string, number>();
  revision(root: string) { return this.revisions.get(root) ?? 0; }
  touch(root: string) {
    const next = this.revision(root) + 1;
    this.revisions.set(root, next);
    this.emit("change", root, next);
  }
}
