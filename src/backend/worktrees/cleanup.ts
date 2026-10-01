import type { SessionSummary } from "../../contracts/sessions.js";
import type { WorktreeCleanupRules, WorktreeSettings } from "../../contracts/worktrees.js";
import type { ProjectStore } from "../projects/store.js";
import type { Sessions } from "../sessions/service.js";
import { changeRequestMerged, folderExists, mergedIntoDefault, safeToRemove } from "./cleanup-checks.js";
import { removeWorktree } from "./git-worktrees.js";
import { projectSettings } from "../../contracts/worktrees.js";
import type { WorktreeStore } from "./store.js";

const HOUR_MS = 60 * 60_000, DAY_MS = 24 * HOUR_MS;
type Candidate = { projectId: string; path: string; branch: string; lastActive: number; deleted: boolean };
export type CleanupContext = {
  sessions: Pick<Sessions, "snapshot">;
  projects: Pick<ProjectStore, "list">;
  store: Pick<WorktreeStore, "kept" | "forget">;
  settings: () => WorktreeSettings;
  directory: string;
  // True while a response, Bash job or worktree setup is using the folder.
  busy: (path: string) => boolean;
  changed: (root: string) => void;
  now?: () => number;
};
/** Why a worktree may go, by the project's rules; null keeps it. */
async function eligible(candidate: Candidate, rules: WorktreeCleanupRules, now: number, signal: AbortSignal) {
  if (candidate.deleted && rules.onDelete) return true;
  if (rules.afterDays !== null && now - candidate.lastActive > rules.afterDays * DAY_MS) return true;
  if (!rules.unchanged && !rules.onMerge) return false;
  if (!await mergedIntoDefault(candidate.path, signal).catch(() => false)) return false;
  return rules.unchanged || await changeRequestMerged(candidate.path, candidate.branch, signal).catch(() => false);
}
/**
 * Removes worktrees by the cleanup rules in Settings (T3 Code's storage cleanup): those of deleted sessions, of sessions
 * inactive for a number of days, whose commits are all on the default branch, or whose change request was merged. Only a
 * worktree one session owned is considered, and it is checked again just before removal. Sessions keep their branch and
 * worktree path, so the next message recreates the worktree.
 */
export class WorktreeCleanup {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private again = false;
  constructor(private readonly context: CleanupContext) {
    this.timer = setInterval(() => this.schedule(), HOUR_MS);
    this.timer.unref();
  }
  /** Runs a pass soon; requests during a pass coalesce into one more. */
  schedule() {
    if (this.controller.signal.aborted) return;
    if (this.running) { this.again = true; return; }
    this.running = this.pass().catch(() => { /* The next pass retries. */ }).finally(() => {
      this.running = null;
      if (this.again) { this.again = false; this.schedule(); }
    });
  }
  /** Settles the current pass, for tests and shutdown. */
  async idle() { while (this.running) await this.running; }
  private candidates(): Candidate[] {
    const sessions = this.context.sessions.snapshot().sessions;
    const owners = new Map<string, SessionSummary[]>();
    for (const session of sessions) {
      const path = session.workspace.worktreePath;
      if (path && session.workspace.branch) owners.set(path, [...owners.get(path) ?? [], session]);
    }
    const active = [...owners.entries()].filter(([, owned]) => owned.length === 1).map(([path, [owner]]) =>
      ({ projectId: owner!.projectId, path, branch: owner!.workspace.branch!, lastActive: owner!.updatedAt, deleted: false }));
    const kept = this.context.store.kept().filter(item => !owners.has(item.path))
      .map(item => ({ projectId: item.projectId, path: item.path, branch: item.branch, lastActive: item.deletedAt, deleted: true }));
    return [...active, ...kept];
  }
  private async pass() {
    const { signal } = this.controller, now = (this.context.now ?? Date.now)();
    const projects = this.context.projects.list();
    for (const candidate of this.candidates()) {
      signal.throwIfAborted();
      const project = projects.find(item => item.id === candidate.projectId);
      if (!project) continue;
      if (candidate.deleted && !folderExists(candidate.path)) { this.context.store.forget(candidate.path); continue; }
      const rules = projectSettings(this.context.settings(), candidate.projectId).cleanup;
      if (!folderExists(candidate.path) || this.context.busy(candidate.path)) continue;
      if (!await eligible(candidate, rules, now, signal)) continue;
      const roots = projects.map(item => item.path);
      if (!await safeToRemove(candidate.path, candidate.branch, this.context.directory, roots, signal).catch(() => false)) continue;
      // Settings, ownership and activity may have changed during the checks above.
      const current = this.candidates().find(item => item.path === candidate.path);
      const currentRules = projectSettings(this.context.settings(), candidate.projectId).cleanup;
      if (!current || JSON.stringify(currentRules) !== JSON.stringify(rules) || current.lastActive !== candidate.lastActive || this.context.busy(candidate.path)) continue;
      try { await removeWorktree(project.path, candidate.path, false, signal); }
      catch { continue; }
      if (candidate.deleted) this.context.store.forget(candidate.path);
      this.context.changed(candidate.path);
      this.context.changed(project.path);
    }
  }
  async close() { clearInterval(this.timer); this.controller.abort(); await this.idle(); }
}
