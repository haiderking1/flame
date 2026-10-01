import { GitError, type GitOperation, type GitStart } from "../../contracts/git.js";
import { sameStart } from "./same-start.js";
/** A failed progress write leaves durable claims intact and blocks further mutations. */
export class GitHealth {
  private readonly uncertain = new Map<string, GitOperation>();
  private blocked = false;
  assertWritable() { if (this.blocked) throw new GitError({ code: "STORAGE", message: "Git progress storage failed. Inspect repository state and fix storage, then restart Flame. Chat and read-only Git views remain available." }); }
  find(input: GitStart) {
    const operation = this.uncertain.get(input.requestId);
    if (operation && !sameStart(input, operation)) throw new GitError({ code: "INVALID", message: "This request ID already belongs to another Git action." });
    return operation;
  }
  fail(operation: GitOperation) {
    this.blocked = true;
    this.uncertain.set(operation.requestId, { ...operation, state: "interrupted", phase: "Progress storage failed", hook: null, updatedAt: Date.now(),
      detail: `${operation.commit ? `Commit ${operation.commit.slice(0,12)} was created. ` : ""}Git progress could not be saved. Some changes may already have happened. Inspect the repository and remote, fix storage and restart Flame before further actions. This claim will not be replayed.` });
  }
  project(projectId: string) { return [...this.uncertain.values()].filter(operation => operation.projectId === projectId); }
  merge(projectId: string, stored: readonly GitOperation[]) {
    const receipts = this.project(projectId), known = new Set(stored.map(operation => operation.requestId));
    return [...receipts.filter(operation => !known.has(operation.requestId)), ...stored.map(operation => this.uncertain.get(operation.requestId) ?? operation)];
  }
}
