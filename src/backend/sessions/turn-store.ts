import { workActivity } from "../turns/work-activity.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { TurnSnapshot, type TurnStatus } from "../../contracts/turns.js";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import type { ModelSelection } from "../../contracts/models.js";

export const turnInvalid = (message: string) => new SessionError({ code: "INVALID", message });
export class TurnStore {
  constructor(private db: DatabaseSync, private read: () => SessionDocument,
    private transaction: <T>(work: () => T) => T,
    private append: (revision: number, requestId: string, text: string) => SessionDocument) {}
  snapshot(id?: string): TurnSnapshot | null {
    this.read();
    const row = id ? this.db.prepare("SELECT *, entry_id AS entryId FROM turns WHERE id=?").get(id)
      : this.db.prepare("SELECT *, entry_id AS entryId FROM turns ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    if (!row) return null;
    const finished = row.entryId ? this.db.prepare("SELECT created_at FROM entries WHERE id=?").get(String(row.entryId)) : null;
    const activity = workActivity(String(row.id), String(row.text), JSON.parse(String(row.output)), String(row.status), Number(row.created_at), finished ? Number(finished.created_at) : null);
    return Schema.decodeUnknownSync(TurnSnapshot)({ ...row, ...(activity ? { activity } : {}) });
  }
  assertIdle() {
    if (this.db.prepare("SELECT 1 FROM turns WHERE status='running'").get()) throw turnInvalid("Stop the active response before changing this session.");
  }
  start(revision: number, id: string, text: string, settings: ModelSelection, accountKey = "") {
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT e.text FROM turns t JOIN entries e ON e.id=t.user_id WHERE t.id=?").get(id);
      if (prior) {
        if (prior.text !== text) throw turnInvalid("This submission identifier already belongs to another message.");
        return this.read();
      }
      this.assertIdle();
      if (this.db.prepare("SELECT 1 FROM entries WHERE request_id=?").get(id)) throw turnInvalid("This message was already saved locally. Send a new message to start a response.");
      const document = this.append(revision, id, text);
      this.db.prepare("INSERT INTO turns(id,user_id,status,settings,account_key,revision,created_at) VALUES (?,?,'running',?,?,?,?)")
        .run(id, document.leafId, JSON.stringify(settings), accountKey, document.revision, Date.now());
      return document;
    });
  }
  backgroundStart(id: string, settings: ModelSelection, accountKey: string, output: unknown[]) {
    return this.transaction(() => {
      this.assertIdle();
      let current = this.read();
      if (current.settledAt !== null) {
        this.db.prepare("UPDATE session SET settled_at=NULL, revision=revision+1, updated_at=? WHERE singleton=1").run(Date.now());
        current = this.read();
      }
      const prior = this.db.prepare("SELECT user_id FROM turns ORDER BY created_at DESC,rowid DESC LIMIT 1").get();
      if (!prior) throw turnInvalid("No prior user request for this background notification.");
      this.db.prepare("INSERT INTO turns(id,user_id,status,settings,account_key,output,revision,created_at) VALUES (?,?,'running',?,?,?,?,?)")
        .run(id, String(prior.user_id), JSON.stringify(settings), accountKey, JSON.stringify(output), current.revision, Date.now());
      return current;
    });
  }
  progress(id: string, text: string, output: unknown[]) {
    const encoded = JSON.stringify(output);
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw turnInvalid("Agent history exceeds 8 MiB. Start a new session.");
    this.checkpoint(id, text);
    this.db.prepare("UPDATE turns SET output=? WHERE id=? AND status='running'").run(encoded, id);
  }
  checkpoint(id: string, text: string) {
    this.read();
    if (Buffer.byteLength(text) > 1024 * 1024) throw turnInvalid("The response exceeded Flame's 1 MiB response limit.");
    this.db.prepare("UPDATE turns SET text=? WHERE id=? AND status='running'").run(text, id);
  }
  finish(id: string, status: Exclude<TurnStatus, "running">, text: string, message: string | null, output: unknown[] = []) {
    return this.transaction(() => {
      const current = this.read();
      const turn = this.db.prepare("SELECT * FROM turns WHERE id=? AND status='running'").get(id);
      if (!turn) return current;
      let entryId: string | null = null;
      if (text || output.length) {
        entryId = randomUUID();
        this.db.prepare("INSERT INTO entries VALUES (?,?,?,'assistant',?,?,NULL)")
          .run(entryId, current.leafId, Date.now(), text, String(turn.settings));
        this.db.prepare("UPDATE session SET leaf_id=? WHERE singleton=1").run(entryId);
      }
      this.db.prepare("UPDATE session SET revision=revision+1,updated_at=? WHERE singleton=1").run(Date.now());
      const saved = this.read();
      this.db.prepare("UPDATE turns SET status=?,text=?,message=?,output=?,revision=?,entry_id=? WHERE id=?")
        .run(status, text, message, JSON.stringify(output), saved.revision, entryId, id);
      return saved;
    });
  }
  recover() {
    return this.transaction(() => {
      this.read();
      // The original client emitted this exact error only AFTER validating an
      // explicit successful terminal event. If its streamed text was saved,
      // correct that proven false failure without changing or replaying content.
      const candidates = this.db.prepare(`SELECT id,text FROM turns
        WHERE status='failed' AND message='OpenAI finished without an assistant message.' AND entry_id IS NOT NULL`).all();
      let repaired = false;
      for (const row of candidates) if (String(row.text).trim()) {
        this.db.prepare("UPDATE turns SET status='completed',message=NULL WHERE id=?").run(String(row.id));
        repaired = true;
      }
      if (repaired) this.db.prepare("UPDATE session SET revision=revision+1 WHERE singleton=1").run();
      const turn = this.db.prepare("SELECT id,text,output FROM turns WHERE status='running'").get();
      if (turn) this.finish(String(turn.id), "interrupted", String(turn.text), "Flame stopped before this response finished. It was not replayed.", JSON.parse(String(turn.output)));
      return this.read();
    });
  }
  context(settings?: ModelSelection, accountKey = ""): unknown[] {
    const current = this.read();
    const rows = this.db.prepare(`WITH RECURSIVE chain AS (
      SELECT *,0 AS depth FROM entries WHERE id=? UNION ALL
      SELECT e.*,c.depth+1 FROM entries e JOIN chain c ON e.id=c.parent_id WHERE c.depth<10000
    ) SELECT c.*,t.output,t.status,t.account_key FROM chain c LEFT JOIN turns t ON t.entry_id=c.id ORDER BY depth DESC`).iterate(current.leafId);
    const input: unknown[] = [];
    let first = true, size = 0;
    for (const row of rows) {
      if (first && row.parent_id) throw turnInvalid("This conversation is too large. Start a new session; automatic compaction is not available yet.");
      first = false;
      size += Buffer.byteLength(String(row.text ?? "")) + Buffer.byteLength(String(row.output ?? ""));
      if (size > 8 * 1024 * 1024) throw turnInvalid("This conversation is too large. Start a new session; automatic compaction is not available yet.");
      if (row.kind === "user") input.push({ role: "user", content: [{ type: "input_text", text: row.text }] });
      if (row.kind === "assistant") {
        const output: unknown[] = JSON.parse(String(row.output ?? "[]"));
        if (row.status === "completed" && output.length && row.account_key === accountKey && (!settings || JSON.parse(String(row.settings)).modelId === settings.modelId)) input.push(...output);
        else input.push({ role: "assistant", content: [{ type: "output_text", text: `${row.text}${row.status !== 'completed' ? '\n[Response interrupted.]' : ''}` }] });
      }
    }
    if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024) throw turnInvalid("This conversation is too large. Start a new session; automatic compaction is not available yet.");
    return input;
  }
}
