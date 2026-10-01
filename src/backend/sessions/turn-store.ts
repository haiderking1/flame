import type { ImageStore } from "../images/store.js";
import { ContextInfo, type ContextInfo as Context } from "../../contracts/compaction.js";
import { workActivity } from "../turns/work-activity.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { TurnSnapshot, type TurnStatus } from "../../contracts/turns.js";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import type { ModelSelection } from "../../contracts/models.js";
import type { CompactionStore } from "./compaction-store.js";
import { ManualTurnStore } from "./manual-turn-store.js";
import { outputDigest } from "./context-items.js";
import { CHAIN } from "./chain.js";

export const turnInvalid = (message: string) => new SessionError({ code: "INVALID", message });
export class TurnStore {
  constructor(private db: DatabaseSync, private read: () => SessionDocument,
    private transaction: <T>(work: () => T) => T,
    private append: (revision: number, requestId: string, text: string, images?: readonly string[]) => SessionDocument,
    private restoreToolResults: (id: string, output: unknown[]) => unknown[] = (_id, output) => output,
    private images?: ImageStore, private compactions?: CompactionStore) {}
  manualStart(revision: number, id: string, settings: ModelSelection, accountKey: string) {
    return new ManualTurnStore(this.db, this.read, this.transaction, () => this.assertIdle()).start(revision, id, settings, accountKey);
  }
  manualFinish(id: string, status: Exclude<TurnStatus, "running">, message: string | null) {
    return new ManualTurnStore(this.db, this.read, this.transaction, () => this.assertIdle()).finish(id, status, message);
  }
  phase(id: string, phase: "responding" | "compacting", context?: Context, ledgerTokens = 0, overhead = 0) {
    this.read();
    if (context) Schema.decodeUnknownSync(ContextInfo)(context);
    if (!Number.isSafeInteger(ledgerTokens) || ledgerTokens < 0) throw turnInvalid("Invalid context ledger token count.");
    if (!Number.isSafeInteger(overhead) || overhead < 0) throw turnInvalid("Invalid context instruction token count.");
    this.transaction(() => {
      let projection: string | null = null;
      if (context && this.compactions) {
        const turn = this.db.prepare("SELECT settings,account_key FROM turns WHERE id=? AND status='running'").get(id);
        if (!turn) throw turnInvalid("The active operation changed before its context could be saved.");
        const captured = this.compactions.capture(JSON.parse(String(turn.settings)), String(turn.account_key));
        projection = JSON.stringify({ checkpointId: captured.checkpointId, count: captured.input.length, digest: outputDigest(captured.input), ledgerTokens, overhead });
      }
      const saved = context
        ? this.db.prepare("UPDATE turns SET phase=?,context=?,context_projection=? WHERE id=? AND status='running'").run(phase, JSON.stringify(context), projection, id)
        : this.db.prepare("UPDATE turns SET phase=? WHERE id=? AND status='running'").run(phase, id);
      if (saved.changes !== 1) throw turnInvalid("The active operation changed before its context could be saved.");
    });
  }
  snapshot(id?: string): TurnSnapshot | null {
    this.read();
    const row = id ? this.db.prepare("SELECT *, entry_id AS entryId FROM turns WHERE id=?").get(id)
      : this.db.prepare("SELECT *, entry_id AS entryId FROM turns ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
    if (!row) return null;
    const finished = row.entryId ? this.db.prepare("SELECT created_at FROM entries WHERE id=?").get(String(row.entryId)) : null;
    const activity = workActivity(String(row.id), String(row.text), this.restoreToolResults(String(row.id), JSON.parse(String(row.output))), String(row.status), Number(row.created_at), finished ? Number(finished.created_at) : null);
    const { context: storedContext, ...snapshot } = row;
    const toolResults = (JSON.parse(String(row.output)) as unknown[]).filter(item => (item as { type?: unknown } | null)?.type === "function_call_output").length;
    return Schema.decodeUnknownSync(TurnSnapshot)({ ...snapshot, toolResults, ...(storedContext ? { context: JSON.parse(String(storedContext)) } : {}), ...(activity ? { activity } : {}) });
  }
  /** The latest run in brief: no output is decoded, so every session can be checked often. */
  state() {
    const row = this.db.prepare(`SELECT t.id AS turnId, t.status, COALESCE(t.operation,'response') AS operation, t.created_at AS startedAt, e.created_at AS finishedAt
      FROM turns t LEFT JOIN entries e ON e.id=t.entry_id ORDER BY t.created_at DESC, t.rowid DESC LIMIT 1`).get();
    if (!row) return null;
    return { turnId: String(row.turnId), status: String(row.status) as TurnStatus, operation: String(row.operation) as "response" | "compaction", startedAt: Number(row.startedAt),
      finishedAt: row.status === "running" ? null : row.finishedAt === null ? Number(row.startedAt) : Number(row.finishedAt) };
  }
  /** How many responses this session has run. */
  runs() { return Number(this.db.prepare("SELECT count(*) AS count FROM turns WHERE COALESCE(operation,'response')='response'").get()?.count ?? 0); }
  /** A compaction is tied to the settings it started with; a response is not, since its own run keeps them. */
  assertNotCompacting() {
    if (this.db.prepare("SELECT 1 FROM turns WHERE status='running' AND operation='compaction'").get()) throw turnInvalid("Wait for compaction to finish before changing the model.");
  }
  assertIdle() {
    if (this.db.prepare("SELECT 1 FROM turns WHERE status='running'").get()) throw turnInvalid("Stop the active response before changing this session.");
  }
  start(revision: number, id: string, text: string, settings: ModelSelection, accountKey = "", images: readonly string[] = []) {
    return this.transaction(() => {
      const prior = this.db.prepare("SELECT e.id,e.text FROM turns t JOIN entries e ON e.id=t.user_id WHERE t.id=?").get(id);
      if (prior) {
        if (this.db.prepare("SELECT operation FROM turns WHERE id=?").get(id)?.operation !== "response") throw turnInvalid("This submission identifier already belongs to a compaction operation.");
        if (prior.text !== text || JSON.stringify(this.images?.list(String(prior.id)).map(image => image.id) ?? []) !== JSON.stringify(images)) throw turnInvalid("This submission identifier already belongs to another message.");
        return this.read();
      }
      this.assertIdle();
      if (this.db.prepare("SELECT 1 FROM entries WHERE request_id=?").get(id)) throw turnInvalid("This message was already saved locally. Send a new message to start a response.");
      const document = this.append(revision, id, text, images);
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
      const prior = this.db.prepare(`${CHAIN} SELECT user_id FROM turns WHERE operation='response' AND user_id IN (SELECT id FROM chain) ORDER BY created_at DESC,rowid DESC LIMIT 1`).get();
      if (!prior) throw turnInvalid("No prior user request for this background notification.");
      this.db.prepare("INSERT INTO turns(id,user_id,status,settings,account_key,output,revision,created_at) VALUES (?,?,'running',?,?,?,?,?)")
        .run(id, String(prior.user_id), JSON.stringify(settings), accountKey, JSON.stringify(output), current.revision, Date.now());
      return current;
    });
  }
  progress(id: string, text: string, output: unknown[]) {
    const encoded = JSON.stringify(output);
    if (Buffer.byteLength(encoded) > 256 * 1024 * 1024) throw turnInvalid("The active response exceeded Flame's durable transcript limit.");
    this.transaction(() => {
      this.checkpoint(id, text);
      this.db.prepare("UPDATE turns SET output=? WHERE id=? AND status='running'").run(encoded, id);
    });
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
      if (turn.operation === "compaction") return this.manualFinish(id, status, message);
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
    if (!this.compactions) throw turnInvalid("Conversation context storage is unavailable.");
    return this.compactions.capture(settings, accountKey).input;
  }
}
