import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { DEFAULT_WORKTREE_SETTINGS, ProjectWorktreeSettings, WorktreeDefaults, type WorktreeSettings } from "../../contracts/worktrees.js";

/** A worktree kept after its last session was deleted, so cleanup can still find it. */
export type KeptWorktree = { path: string; projectId: string; branch: string; deletedAt: number };
/** Worktree settings and the worktrees of deleted sessions, in Flame's main database. */
export class WorktreeStore {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS worktree_defaults (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), settings TEXT NOT NULL CHECK(json_valid(settings))) STRICT;
      CREATE TABLE IF NOT EXISTS worktree_projects (project_id TEXT PRIMARY KEY, settings TEXT NOT NULL CHECK(json_valid(settings))) STRICT;
      CREATE TABLE IF NOT EXISTS worktree_kept (path TEXT PRIMARY KEY, project_id TEXT NOT NULL, branch TEXT NOT NULL, deleted_at INTEGER NOT NULL) STRICT;`);
  }
  settings(): WorktreeSettings {
    const row = this.db.prepare("SELECT settings FROM worktree_defaults WHERE singleton=1").get();
    let defaults = DEFAULT_WORKTREE_SETTINGS;
    // Unreadable saved settings fall back to the defaults rather than blocking sessions.
    if (row) try { defaults = Schema.decodeUnknownSync(WorktreeDefaults)({ ...DEFAULT_WORKTREE_SETTINGS, ...JSON.parse(String(row.settings)) }); } catch { /* Defaults. */ }
    const projects = this.db.prepare("SELECT settings FROM worktree_projects ORDER BY project_id").all().flatMap(row => {
      try { return [Schema.decodeUnknownSync(ProjectWorktreeSettings)(JSON.parse(String(row.settings)))]; } catch { return []; }
    });
    return { defaults, projects };
  }
  saveDefaults(defaults: WorktreeDefaults) {
    this.db.prepare("INSERT INTO worktree_defaults VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET settings=excluded.settings")
      .run(JSON.stringify(Schema.encodeSync(WorktreeDefaults)(defaults)));
  }
  saveProject(project: ProjectWorktreeSettings) {
    this.db.prepare("INSERT INTO worktree_projects VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET settings=excluded.settings")
      .run(project.projectId, JSON.stringify(Schema.encodeSync(ProjectWorktreeSettings)(project)));
  }
  keep(worktree: KeptWorktree) {
    this.db.prepare("INSERT INTO worktree_kept VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET project_id=excluded.project_id, branch=excluded.branch, deleted_at=excluded.deleted_at")
      .run(worktree.path, worktree.projectId, worktree.branch, worktree.deletedAt);
  }
  kept(): KeptWorktree[] {
    return this.db.prepare("SELECT path, project_id AS projectId, branch, deleted_at AS deletedAt FROM worktree_kept ORDER BY deleted_at").all()
      .map(row => ({ path: String(row.path), projectId: String(row.projectId), branch: String(row.branch), deletedAt: Number(row.deletedAt) }));
  }
  forget(path: string) { this.db.prepare("DELETE FROM worktree_kept WHERE path=?").run(path); }
  close() { this.db.close(); }
}
