import { EventEmitter } from "node:events";
import { GitError, type GitStart } from "../../contracts/git.js";
import { GitService, type GitServiceOptions } from "./service.js";
import { GitStore } from "./store.js";
import type { WorkspaceTarget } from "../../contracts/workspace-target.js";
export type GitRuntime = Pick<GitService, "list" | "status" | "file" | "start" | "hosting" | "open" | "close"> & Pick<EventEmitter, "on" | "off">;
class UnavailableGit extends EventEmitter {
  constructor(private readonly failure: GitError) { super(); }
  list(_target: WorkspaceTarget): never { throw this.failure; }
  async status(_target: WorkspaceTarget): Promise<never> { throw this.failure; }
  async file(_input: WorkspaceTarget & { path: string; mode: "working" | "staged" }): Promise<never> { throw this.failure; }
  async start(_input: GitStart): Promise<never> { throw this.failure; }
  async hosting(): Promise<never> { throw this.failure; }
  async open(_target: WorkspaceTarget, _path: string): Promise<never> { throw this.failure; }
  async close() {}
}
/** Optional Git persistence must never prevent chat and session services starting. */
export function openGitRuntime(filename: string, root: (target: WorkspaceTarget) => string, options: GitServiceOptions = {}): GitRuntime {
  try {
    const store = new GitStore(filename), service = new GitService(store, root, options);
    const close = service.close.bind(service);
    service.close = async () => { try { await close(); } finally { store.close(); } };
    return service;
  } catch (error) {
    return new UnavailableGit(error instanceof GitError ? error : new GitError({ code: "STORAGE", message: "Git operation storage could not be opened. Chat is still available. Check disk space, file ownership and database integrity, then restart Flame." }));
  }
}
