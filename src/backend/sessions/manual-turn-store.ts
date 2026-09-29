import type { DatabaseSync } from "node:sqlite";
import type { ModelSelection } from "../../contracts/models.js";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import type { TurnStatus } from "../../contracts/turns.js";

export class ManualTurnStore {
  constructor(private db: DatabaseSync, private read: () => SessionDocument,
    private transaction: <T>(work: () => T) => T, private assertIdle: () => void) {}
  start(revision: number, id: string, settings: ModelSelection, accountKey: string) {
    return this.transaction(() => {
      const current = this.read();
      const prior = this.db.prepare("SELECT operation FROM turns WHERE id=?").get(id);
      if (prior) {
        if (prior.operation !== "compaction") throw new SessionError({ code: "INVALID", message: "This request identifier already belongs to a response." });
        return current;
      }
      if (!Number.isSafeInteger(revision) || revision !== current.revision) throw new SessionError({ code: "CONFLICT", message: "This session changed elsewhere. Reopen it before compacting." });
      this.assertIdle();
      let leaf = current.leafId;
      const seen = new Set<string>();
      while (leaf !== null) {
        if (seen.has(leaf)) throw new SessionError({ code: "STORAGE", message: "The conversation's parent references are invalid." });
        seen.add(leaf);
        const row = this.db.prepare("SELECT kind,parent_id FROM entries WHERE id=?").get(leaf);
        if (!row) throw new SessionError({ code: "STORAGE", message: "The conversation's parent references are invalid." });
        if (row.kind === "user") break;
        leaf = row.parent_id === null ? null : String(row.parent_id);
      }
      if (leaf === null) throw new SessionError({ code: "INVALID", message: "Send a message before compacting this conversation." });
      this.db.prepare(`INSERT INTO turns(id,user_id,status,settings,account_key,revision,created_at,operation,phase)
        VALUES (?,?,'running',?,?,?,?,'compaction','compacting')`).run(id, leaf, JSON.stringify(settings), accountKey, current.revision, Date.now());
      return current;
    });
  }
  finish(id: string, status: Exclude<TurnStatus, "running">, message: string | null) {
    return this.transaction(() => {
      const current = this.read();
      const turn = this.db.prepare("SELECT id FROM turns WHERE id=? AND status='running' AND operation='compaction'").get(id);
      if (!turn) return current;
      this.db.prepare("UPDATE session SET revision=revision+1,updated_at=? WHERE singleton=1").run(Date.now());
      this.db.prepare("UPDATE turns SET status=?,message=?,revision=(SELECT revision FROM session WHERE singleton=1) WHERE id=?").run(status, message, id);
      return this.read();
    });
  }
}
