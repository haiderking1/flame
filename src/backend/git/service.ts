import { EventEmitter } from "node:events";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Schema } from "effect";
import { GitError, GitStart, type GitHosting, type GitOperation, type GitPhase } from "../../contracts/git.js";
import { GitStore } from "./store.js";
import { safeGitMessage } from "./command.js";
import { repositoryStatus } from "./status.js";
import { readGitFile } from "./file.js";
import { GitHealth } from "./health.js";
import { RemoteStatus } from "./remote-status.js";
import { hostings } from "./hosting/index.js";
import { runAction } from "./actions/run.js";
import type { GitWriter } from "./writer/writer.js";
import type { WorkspaceTarget } from "../../contracts/workspace-target.js";

const COMMIT_ACTIONS = new Set<GitStart["action"]>(["commit", "commit_push", "commit_push_pr"]);
const HOOK_OUTPUT_INTERVAL_MS = 250;
const unavailableWriter: GitWriter = {
  commit: async () => { throw new GitError({ code: "UNAVAILABLE", message: "Text generation is unavailable. Write the commit message yourself." }); },
  changeRequest: async () => { throw new GitError({ code: "UNAVAILABLE", message: "Text generation is unavailable." }); },
};
export type GitServiceOptions = {
  writer?: GitWriter;
  // Opens a file in the user's default application; absent where no desktop shell is available.
  openPath?: (path: string) => Promise<void>;
  // Called with a workspace root when its status may have changed (an action ran, or fetched refs or change requests changed).
  changed?: (root: string) => void;
};

export class GitService extends EventEmitter {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly health = new GitHealth();
  private readonly remote: RemoteStatus;
  private closed = false;
  private reads = 0;
  constructor(private readonly store: GitStore, private readonly root: (target: WorkspaceTarget) => string, private readonly options: GitServiceOptions = {}) {
    super();
    this.remote = new RemoteStatus(root => this.options.changed?.(root), root => this.active.has(root));
  }
  /** Recent actions in the target's folder: sessions sharing a worktree, or the project checkout, see the same list. */
  list(target: WorkspaceTarget) {
    const root = this.root(target), roots = new Map<string, string | null>();
    const here = (operation: GitOperation) => {
      const key = `${operation.projectId}\0${operation.sessionId ?? ""}\0${operation.worktreePath ?? ""}`;
      if (!roots.has(key)) roots.set(key, this.rootOf(operation));
      return roots.get(key) === root;
    };
    try { return this.health.merge(target.projectId, this.store.list(target.projectId)).filter(here); }
    catch (error) { const uncertain = this.health.project(target.projectId).filter(here); if (uncertain.length) return uncertain; throw error; }
  }
  private rootOf(operation: WorkspaceTarget) { try { return this.root(operation); } catch { return null; } }
  private async view<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) throw new GitError({ code: "UNAVAILABLE", message: "Git services are shutting down." });
    if (this.reads >= 4) throw new GitError({ code: "BUSY", message: "Git views are busy. Wait for the current reads, then refresh." });
    this.reads++;
    try { return await work(); } finally { this.reads--; }
  }
  status(target: WorkspaceTarget, signal?: AbortSignal) {
    return this.view(async () => { const root = this.root(target); return this.remote.attach(await repositoryStatus(target.projectId, root, signal, true), root); });
  }
  file(input: WorkspaceTarget & { path: string; mode: "working" | "staged" }, signal?: AbortSignal) { return this.view(() => readGitFile(this.root(input), input.path, input.mode, signal)); }
  /** Which hosting CLIs are installed and signed in, for publishing repositories. */
  async hosting(signal?: AbortSignal): Promise<GitHosting[]> {
    const cwd = process.cwd();
    return Promise.all(hostings.map(async hosting => {
      try {
        const [account, protocol] = await Promise.all([hosting.account(cwd, signal), hosting.protocol(cwd, signal)]);
        return { kind: hosting.kind, name: hosting.name, host: hosting.host, ready: true, account, hint: null, protocol };
      } catch (error) { return { kind: hosting.kind, name: hosting.name, host: hosting.host, ready: false, account: null, hint: error instanceof GitError ? error.message : `${hosting.name} is unavailable.`, protocol: "https" as const }; }
    }));
  }
  /** Opens a file inside the target's folder with the user's default application. */
  async open(workspace: WorkspaceTarget, path: string) {
    if (!this.options.openPath) throw new GitError({ code: "UNAVAILABLE", message: "Opening files is unavailable here." });
    if (!path || path.includes("\0")) throw new GitError({ code: "INVALID", message: "This file path cannot be opened." });
    const root = await realpath(this.root(workspace));
    let target: string;
    try { target = await realpath(resolve(root, path)); await lstat(target); }
    catch { throw new GitError({ code: "NOT_FOUND", message: "This file no longer exists. Refresh Git status." }); }
    const inside = relative(root, target);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new GitError({ code: "INVALID", message: "Only files inside the project can be opened." });
    await this.options.openPath(target).catch(() => { throw new GitError({ code: "COMMAND", message: "The file could not be opened. Check your default application for this file type." }); });
  }
  async start(raw: GitStart): Promise<GitOperation> {
    let input: GitStart;
    try { input = Schema.decodeUnknownSync(GitStart)(raw); } catch { throw new GitError({ code: "INVALID", message: "Invalid Git action request." }); }
    if (this.closed) throw new GitError({ code: "UNAVAILABLE", message: "Git services are shutting down." });
    const uncertain = this.health.find(input); if (uncertain) return uncertain;
    this.health.assertWritable();
    const old = this.store.get(input.requestId);
    if (old) return this.store.claim(input);
    const cwd = await realpath(this.root(input));
    if (this.closed) throw new GitError({ code: "UNAVAILABLE", message: "Git services are shutting down." });
    const changed = this.health.find(input); if (changed) return changed;
    this.health.assertWritable();
    if (this.store.get(input.requestId)) return this.store.claim(input);
    // The claim and in-process lock are installed without an intervening await.
    if (this.active.has(cwd)) throw new GitError({ code: "BUSY", message: "A Git action is already running for this repository." });
    if (this.active.size >= 4) throw new GitError({ code: "BUSY", message: "Four Git actions are already running. Wait for one to finish." });
    this.validate(input);
    const operation = this.store.claim(input), controller = new AbortController();
    const done = Promise.resolve().then(() => this.execute(cwd, operation, controller.signal)).finally(() => { this.active.delete(cwd); this.remote.invalidate(cwd); this.options.changed?.(this.rootOf(input) ?? cwd); });
    this.active.set(cwd, { controller, done }); this.emit("change", input.projectId);
    void done.catch(() => { /* A storage failure leaves the durable claim interrupted on recovery. */ });
    return operation;
  }
  private validate(input: GitStart) {
    const commits = COMMIT_ACTIONS.has(input.action);
    if (input.message.includes("\0") || (input.message.trim() && !commits)) throw new GitError({ code: "INVALID", message: "A commit message only applies to commit actions." });
    if (input.filePaths && (!commits || input.filePaths.some(path => path.includes("\0") || isAbsolute(path)))) throw new GitError({ code: "INVALID", message: "Select files inside the repository to commit." });
    if (input.featureBranch && !commits && input.action !== "push" && input.action !== "create_pr") throw new GitError({ code: "INVALID", message: "A feature branch only applies to commit, push and change request actions." });
    if ((input.action === "publish") !== !!input.publish) throw new GitError({ code: "INVALID", message: "Choose where to publish the repository." });
  }
  private async execute(cwd: string, original: GitOperation, signal: AbortSignal) {
    let operation = original, pendingOutput: ReturnType<typeof setTimeout> | undefined;
    const publish = (patch: Partial<GitOperation>) => {
      const next = { ...operation, ...patch, updatedAt: Date.now() };
      operation = next;
      try { this.store.update(next); } catch { throw new GitError({ code: "STORAGE", message: "Git progress could not be saved. Inspect repository state and storage before retrying." }); }
      this.emit("change", operation.projectId);
    };
    // Hook output can arrive many times a second; persist at most a few updates per second.
    const flushOutput = () => { pendingOutput = undefined; publish({}); };
    const progress = {
      phase: (_phase: GitPhase, label: string) => { clearTimeout(pendingOutput); publish({ phase: label, phaseStartedAt: Date.now(), hook: null }); },
      commit: (sha: string) => publish({ commit: sha }),
      hooks: {
        started: (name: string) => { clearTimeout(pendingOutput); publish({ hook: { name, startedAt: Date.now(), output: null } }); },
        output: (text: string) => {
          if (!operation.hook) return;
          operation = { ...operation, hook: { ...operation.hook, output: text } };
          pendingOutput ??= setTimeout(() => { try { flushOutput(); } catch { /* The next phase write reports storage failures. */ } }, HOOK_OUTPUT_INTERVAL_MS);
        },
        finished: () => { clearTimeout(pendingOutput); pendingOutput = undefined; publish({ hook: null, phaseStartedAt: Date.now() }); },
      },
    };
    try {
      const result = await runAction({ root: cwd, operation, signal, progress, writer: this.options.writer ?? unavailableWriter }, phases => publish({ phases }));
      clearTimeout(pendingOutput);
      publish({ state: "completed", phase: "Completed", hook: null, result, detail: null });
    } catch (error) {
      clearTimeout(pendingOutput);
      try { publish({ state: signal.aborted ? "interrupted" : "failed", hook: null,
        detail: `${operation.commit ? `Commit ${operation.commit.slice(0, 7)} was created. ` : ""}${error instanceof GitError ? error.message : safeGitMessage(error instanceof Error ? error.message : "Git failed.")}` }); }
      catch {
        this.health.fail(operation);
        for (const task of this.active.values()) task.controller.abort();
        this.emit("change", operation.projectId);
      }
    }
  }
  async close() { this.closed = true; this.remote.close(); for (const task of this.active.values()) task.controller.abort(); await Promise.allSettled([...this.active.values()].map(task => task.done)); }
}
