import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { pendingWorktree, type SessionWorkspace } from "../../contracts/session-workspace.js";
import type { SessionLocation, SessionSummary } from "../../contracts/sessions.js";
import type { WorkspaceTarget } from "../../contracts/workspace-target.js";
import type { WorktreeSetupSnapshot } from "../../contracts/worktree-setup.js";
import { ProjectWorktreeSettings, WorktreeDefaults } from "../../contracts/worktrees.js";
import type { BranchNamer } from "../git/writer/writer.js";
import type { ProjectStore } from "../projects/store.js";
import type { Sessions } from "../sessions/service.js";
import { bootstrapWorktree, type WorktreeContext } from "./bootstrap.js";
import { isTemporaryWorktreeBranch } from "./branch-names.js";
import { WorktreeCleanup } from "./cleanup.js";
import { asWorktreeError, worktreeError } from "./errors.js";
import { currentBranch, listWorktrees, removeWorktree } from "./git-worktrees.js";
import { followWorktreeBranch, nameWorktreeBranch, restoreMissingWorktree } from "./lifecycle.js";
import { preparePullRequest, resolvePullRequest } from "./pull-requests.js";
import { listRefs } from "./refs.js";
import type { WorkspaceRoots } from "./roots.js";
import { projectSettings } from "../../contracts/worktrees.js";
import { SetupTracker } from "./setup-tracker.js";
import type { WorktreeStore } from "./store.js";
import { switchRef } from "./switch-ref.js";
import { validateWorkspace } from "./workspace-config.js";
import { Schema } from "effect";

export type WorktreesOptions = {
  sessions: Sessions; projects: Pick<ProjectStore, "list">; roots: WorkspaceRoots; store: WorktreeStore; directory: string;
  namer?: BranchNamer;
  // Called with a folder whose files or branch may have changed.
  changed: (root: string) => void;
  // True while a response or Bash job is using any session in the folder.
  busy: (path: string) => boolean;
};
const real = (path: string) => { try { return realpathSync(path); } catch { return null; } };
const RESTART_INTERRUPTED = "interrupted by a server restart";
/** A setup a restart cut short, recorded as T3 Code does: done when the agent had already started, otherwise failed. */
export function reconcileInterruptedSetup(snapshot: WorktreeSetupSnapshot): WorktreeSetupSnapshot {
  const now = Date.now(), agentStarted = snapshot.stages.some(stage => stage.id === "agent" && stage.status === "done");
  return { ...snapshot, phase: agentStarted ? "done" : "failed", endedAt: now, sequence: snapshot.sequence + 1,
    error: agentStarted ? null : "Flame restarted before the worktree setup finished. Send the message again.",
    stages: snapshot.stages.map(stage => stage.status === "running" || stage.status === "pending" ? { ...stage, status: "failed", endedAt: now, detail: RESTART_INTERRUPTED } : stage) };
}
/**
 * Session worktrees: where each session works, creating a worktree on a first message, keeping it in step with its branch,
 * checking out change requests, and removing worktrees on request or by the cleanup rules. Emits "settings" on changes.
 */
export class Worktrees extends EventEmitter {
  readonly tracker: SetupTracker;
  private readonly context: WorktreeContext;
  private readonly cleanup: WorktreeCleanup;
  private readonly closing = new AbortController();
  constructor(private readonly options: WorktreesOptions) {
    super();
    this.setMaxListeners(0);
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    this.tracker = new SetupTracker(options.sessions);
    this.context = { sessions: options.sessions, roots: options.roots, tracker: this.tracker, settings: () => options.store.settings(),
      directory: options.directory, changed: options.changed, background: new Set() };
    this.cleanup = new WorktreeCleanup({ sessions: options.sessions, projects: options.projects, store: options.store, settings: () => options.store.settings(),
      directory: options.directory, changed: options.changed, busy: path => options.busy(path) || this.settingUp(path) });
    this.reconcile();
    options.sessions.on("removed", this.removed);
    this.cleanup.schedule();
  }
  private reconcile() {
    for (const session of this.options.sessions.snapshot().sessions) {
      try {
        this.options.sessions.workspace(session, record => {
          const setup = record.setup();
          if (setup?.phase === "running") record.saveSetup(reconcileInterruptedSetup(setup));
        });
      } catch { /* An unreadable session reports itself when opened. */ }
    }
  }
  private settingUp(path: string) {
    return this.options.sessions.snapshot().sessions.some(session => session.workspace.worktreePath === path && this.tracker.find(session)?.current.phase === "running");
  }
  /** Keeps track of a deleted session's worktree that no other session uses, for cleanup. */
  private removed = (session: SessionSummary) => {
    const { worktreePath: path, branch } = session.workspace;
    if (!path || !branch || this.options.sessions.snapshot().sessions.some(other => other.workspace.worktreePath === path)) return;
    try { this.options.store.keep({ path, projectId: session.projectId, branch, deletedAt: Date.now() }); } catch { return; }
    if (projectSettings(this.options.store.settings(), session.projectId).cleanup.onDelete) this.cleanup.schedule();
  };
  settings() { return this.options.store.settings(); }
  saveDefaults(defaults: WorktreeDefaults) {
    this.options.store.saveDefaults(Schema.decodeUnknownSync(WorktreeDefaults)(defaults));
    this.emit("settings"); this.cleanup.schedule();
    return this.settings();
  }
  saveProject(project: ProjectWorktreeSettings) {
    if (!this.options.projects.list().some(item => item.id === project.projectId)) throw worktreeError("NOT_FOUND", "This project is no longer available.");
    this.options.store.saveProject(Schema.decodeUnknownSync(ProjectWorktreeSettings)(project));
    this.emit("settings"); this.cleanup.schedule();
    return this.settings();
  }
  async configure(location: SessionLocation, revision: number, workspace: SessionWorkspace) {
    const project = this.options.roots.project(location.projectId);
    return this.options.sessions.configureWorkspace(location, revision, await validateWorkspace(project, workspace));
  }
  async refs(target: WorkspaceTarget, query: string, limit: number, signal?: AbortSignal) {
    try { return await listRefs(this.options.roots.target(target), query, limit, signal); } catch (error) { throw asWorktreeError(error, "Branches could not be listed."); }
  }
  /** Switches the branch checked out in the target's folder and records it on the session. */
  async switchRef(target: WorkspaceTarget, ref: string, create: boolean, signal?: AbortSignal) {
    const root = this.options.roots.target(target);
    if (target.sessionId && this.options.busy(root)) throw worktreeError("BUSY", "Wait for the response to finish before switching branches.");
    let branch: string;
    try { branch = await switchRef(root, ref, create, signal); } catch (error) { throw asWorktreeError(error, "The branch could not be switched."); }
    finally { this.options.changed(root); }
    if (target.sessionId) this.options.sessions.updateWorkspace({ projectId: target.projectId, sessionId: target.sessionId }, current => ({ ...current, branch }));
    return { branch };
  }
  /** Removes a deleted session's worktree, when no remaining session uses it. */
  async remove(projectId: string, path: string, signal?: AbortSignal) {
    const project = this.options.roots.project(projectId), wanted = real(path) ?? path;
    if (this.options.sessions.snapshot().sessions.some(session => session.workspace.worktreePath === wanted))
      throw worktreeError("INVALID", "Another session still works in this worktree.");
    const registered = (await listWorktrees(project, signal).catch(error => { throw asWorktreeError(error); })).slice(1).some(tree => (real(tree.path) ?? tree.path) === wanted);
    if (!registered && existsSync(wanted)) throw worktreeError("NOT_FOUND", "That folder is not a worktree of this project.");
    try { if (registered) await removeWorktree(project, wanted, true, signal); }
    catch (error) { throw asWorktreeError(error, `Could not remove ${wanted}.`); }
    this.options.store.forget(wanted);
    this.options.changed(project);
  }
  setup(location: SessionLocation) { return this.tracker.snapshot(location); }
  /** Abandons a worktree still being set up so the response continues in the project checkout; false once too late. */
  workLocally(location: SessionLocation) {
    const run = this.tracker.find(location);
    if (!run?.canWorkLocally) return false;
    run.local.abort();
    return true;
  }
  /**
   * Readies the session's folder for a response to a new message: creates its worktree on the first message, restores
   * a worktree whose folder was deleted, and names a placeholder branch from the message in the background.
   */
  async prepare(location: SessionLocation, turn: { id: string; text: string; images: readonly string[] }, signal: AbortSignal) {
    const workspace = this.options.sessions.read(location).workspace;
    if (pendingWorktree(workspace)) await bootstrapWorktree(this.context, location, turn.id, workspace, signal);
    else {
      // A finished setup belongs to the message that started it; a follow-up message clears its card.
      const previous = this.tracker.snapshot(location);
      if (previous && previous.phase !== "running" && previous.turnId !== turn.id) this.tracker.clear(location);
      const project = this.options.roots.project(location.projectId);
      if (workspace.mode === "local") {
        // A thread in the project checkout remembers the branch it last ran on, so a later switch can be noticed.
        const branch = await currentBranch(project, signal).catch(() => null);
        if (branch && branch !== workspace.branch) this.options.sessions.updateWorkspace(location, current => current.mode === "local" ? { ...current, branch } : null);
      } else if (await restoreMissingWorktree(project, workspace, signal)) this.options.changed(workspace.worktreePath!);
    }
    const current = this.options.sessions.find(location)?.workspace;
    if (!current?.worktreePath || !current.branch || !isTemporaryWorktreeBranch(current.branch) || !this.options.namer) return;
    let images: readonly unknown[] = [];
    try { images = turn.images.length ? this.options.sessions.images(location, store => store.content(turn.images)) : []; } catch { /* Named from the text alone. */ }
    const path = current.worktreePath;
    void nameWorktreeBranch({ ...this.context, sessions: this.options.sessions, namer: this.options.namer,
      renamed: branch => { try { this.tracker.renamed(location, path, branch); } catch { /* The card keeps the placeholder name. */ } } }, location, current,
      { text: turn.text, attachments: [], images }, this.closing.signal);
  }
  /** After a response, adopts a branch the agent switched the session's worktree to. */
  finished(location: SessionLocation) {
    const workspace = this.options.sessions.find(location)?.workspace;
    if (workspace?.worktreePath) void followWorktreeBranch({ sessions: this.options.sessions, changed: this.options.changed }, location, workspace, this.closing.signal).catch(() => {});
  }
  resolvePullRequest(projectId: string, reference: string, signal?: AbortSignal) {
    return resolvePullRequest(this.options.roots.project(projectId), reference, signal).then(result => result.pullRequest, error => { throw asWorktreeError(error, "The change request could not be found."); });
  }
  preparePullRequest(input: { projectId: string; reference: string; mode: "local" | "worktree"; session: SessionLocation | null }, signal?: AbortSignal) {
    if (input.session && this.options.busy(this.options.roots.session(input.session))) throw worktreeError("BUSY", "Wait for the response to finish first.");
    return preparePullRequest(this.context, input, signal).catch(error => { throw asWorktreeError(error, "The change request could not be checked out."); });
  }
  async close() {
    this.options.sessions.off("removed", this.removed);
    this.closing.abort();
    this.tracker.close();
    for (const task of this.context.background) task.controller.abort();
    await Promise.allSettled([...this.context.background].map(task => task.done));
    await this.cleanup.close();
  }
}
