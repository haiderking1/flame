import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import { pendingWorktree, SessionWorkspace } from "../../contracts/session-workspace.js";
import { WorktreeSetupSnapshot } from "../../contracts/worktree-setup.js";

const invalid = (message: string) => new SessionError({ code: "INVALID", message });
const same = (a: SessionWorkspace, b: SessionWorkspace) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Where a session works, and the latest setup of its worktree. User choices are revisioned edits; progress the backend
 * records (a created worktree, a renamed branch) does not advance the revision, so a draft saved meanwhile still lands.
 */
export class WorkspaceRecord {
  constructor(private readonly db: DatabaseSync, private readonly read: () => SessionDocument, private readonly expect: (revision: number) => SessionDocument,
    private readonly transaction: <T>(work: () => T) => T, private readonly assertIdle: () => void,
    private readonly jobsRunning: () => boolean, private readonly hasMessages: () => boolean) {}
  configure(revision: number, next: SessionWorkspace) {
    next = Schema.decodeUnknownSync(SessionWorkspace)(next);
    return this.transaction(() => {
      const current = this.expect(revision);
      if (same(current.workspace, next)) return current;
      this.assertIdle();
      if (pendingWorktree(next) && !pendingWorktree(current.workspace) && this.hasMessages())
        throw invalid("A new worktree can only be chosen before the first message. Pick a branch that already has a worktree instead.");
      if (this.moves(current.workspace, next) && this.jobsRunning()) throw invalid("Stop running Bash jobs before changing where this session works.");
      this.write(next, true);
      return this.read();
    });
  }
  /** Records backend progress; returns null, writing nothing, when `change` declines the current workspace. */
  update(change: (current: SessionWorkspace) => SessionWorkspace | null) {
    return this.transaction(() => {
      const current = this.read();
      const next = change(current.workspace);
      if (!next) return null;
      if (!same(current.workspace, Schema.decodeUnknownSync(SessionWorkspace)(next))) this.write(next, false);
      return this.read();
    });
  }
  setup(): WorktreeSetupSnapshot | null {
    const row = this.db.prepare("SELECT workspace_setup AS setup FROM session WHERE singleton=1").get();
    return row?.setup ? Schema.decodeUnknownSync(WorktreeSetupSnapshot)(JSON.parse(String(row.setup))) : null;
  }
  saveSetup(snapshot: WorktreeSetupSnapshot | null) {
    this.db.prepare("UPDATE session SET workspace_setup=? WHERE singleton=1").run(snapshot && JSON.stringify(Schema.encodeSync(WorktreeSetupSnapshot)(snapshot)));
  }
  private moves(a: SessionWorkspace, b: SessionWorkspace) { return a.mode !== b.mode || a.worktreePath !== b.worktreePath; }
  private write(next: SessionWorkspace, edit: boolean) {
    this.db.prepare(`UPDATE session SET workspace=?${edit ? ", revision=revision+1" : ""} WHERE singleton=1`).run(JSON.stringify(next));
  }
}
