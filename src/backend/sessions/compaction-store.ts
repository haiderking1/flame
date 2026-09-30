import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { CompactionInfo, type CompactionInfo as Info } from "../../contracts/compaction.js";
import type { ModelSelection } from "../../contracts/models.js";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import type { ImageStore } from "../images/store.js";
import { expandImageResults } from "../file-tools/image-results.js";
import { assertCompleteTools, outputDigest, portableInput, portableToolImages, summaryInput } from "./context-items.js";
import { storageError } from "./files.js";

export type CompactionCapture = { leafId: string | null; checkpointId: string | null; input: unknown[]; compactionCount: number; lastCompactedAt: number | null; tokenAnchor?: { tokens: number; count: number; ledgerTokens?: number; overhead?: number } };
export type CompactionSave = {
  expectedLeafId: string | null; previousId: string | null; turnId?: string; outputCount?: number; outputDigest?: string;
  summary: string; kept: unknown[]; modelId: string; accountKey: string;
  tokensBefore: number; tokensAfter: number; trigger: "auto" | "manual" | "overflow";
};
type Row = Record<string, unknown>;
const conflict = () => new SessionError({ code: "CONFLICT", message: "The conversation changed while compacting. Its history and previous checkpoint were preserved." });
const invalid = (message: string) => new SessionError({ code: "INVALID", message });
const array = (encoded: unknown): unknown[] => {
  const parsed: unknown = JSON.parse(String(encoded));
  if (!Array.isArray(parsed)) throw storageError();
  return parsed;
};

export class CompactionStore {
  constructor(private db: DatabaseSync, private read: () => SessionDocument,
    private transaction: <T>(work: () => T) => T, private images?: ImageStore,
    private restoreToolResults: (id: string, output: unknown[]) => unknown[] = (_id, output) => output) {}

  // Only ancestry IDs are loaded up front. Transcript payloads are loaded after
  // locating the latest valid checkpoint, avoiding deserializing covered history.
  private chain(leaf: string | null): string[] {
    const entries: string[] = [], seen = new Set<string>();
    const parent = this.db.prepare("SELECT parent_id FROM entries WHERE id=?");
    while (leaf !== null) {
      if (seen.has(leaf)) throw storageError();
      seen.add(leaf); entries.push(leaf);
      const row = parent.get(leaf);
      if (!row) throw storageError();
      leaf = row.parent_id === null ? null : String(row.parent_id);
    }
    return entries.reverse();
  }
  private valid(row: Row, ancestry: Set<string>) {
    if (row.leaf_id !== null && !ancestry.has(String(row.leaf_id))) return false;
    if (row.turn_id !== null) {
      const turn = this.db.prepare("SELECT status,output,entry_id FROM turns WHERE id=?").get(String(row.turn_id));
      const count = Number(row.output_count);
      // A zero offset compacts only the history before inference starts. Its
      // summary remains useful even if that following response is interrupted.
      if (!turn || (count !== 0 && turn.status !== "completed" && turn.status !== "running")) return false;
      if (count !== 0 && turn.status === "completed" && turn.entry_id !== null && !ancestry.has(String(turn.entry_id))) return false;
      const output = array(turn.output);
      if (!Number.isSafeInteger(count) || count < 0 || count > output.length || outputDigest(output.slice(0, count)) !== row.output_digest) throw storageError();
    }
    return true;
  }
  private checkpoints(ancestry: Set<string>): Row[] {
    return this.db.prepare("SELECT * FROM compactions ORDER BY created_at DESC,rowid DESC").all().filter(row => this.valid(row, ancestry));
  }
  private info(row: Row): Info {
    return Schema.decodeUnknownSync(CompactionInfo)({ id: row.id, leafId: row.leaf_id, createdAt: row.created_at,
      summary: row.summary, modelId: row.model_id, tokensBefore: row.tokens_before, tokensAfter: row.tokens_after, trigger: row.trigger });
  }
  list(): Info[] {
    const current = this.read();
    return this.checkpoints(new Set(this.chain(current.leafId))).reverse().map(row => this.info(row));
  }
  metadata() { return this.list(); }
  capture(settings?: ModelSelection, accountKey = ""): CompactionCapture {
    const current = this.read(), chain = this.chain(current.leafId);
    const checkpoints = this.checkpoints(new Set(chain)), checkpoint = checkpoints[0];
    const input: unknown[] = [];
    let start = 0;
    if (checkpoint) {
      input.push(summaryInput(String(checkpoint.summary)));
      const kept = expandImageResults(array(checkpoint.kept), this.images);
      input.push(...(checkpoint.account_key === accountKey && (!settings || checkpoint.model_id === settings.modelId) ? kept : portableInput(kept)));
      start = checkpoint.leaf_id === null ? 0 : chain.indexOf(String(checkpoint.leaf_id)) + 1;
    }
    const get = this.db.prepare(`SELECT e.*,t.id AS turn_id,t.output,t.status,t.account_key FROM entries e
      LEFT JOIN turns t ON t.entry_id=e.id WHERE e.id=?`);
    for (let index = start; index < chain.length; index++) {
      const row = get.get(chain[index]!);
      if (!row) throw storageError();
      if (row.kind === "user") {
        const ids = this.images?.list(String(row.id)).map(image => image.id) ?? [];
        input.push({ role: "user", content: [{ type: "input_text", text: row.text }, ...(this.images?.content(ids) ?? [])] });
      } else if (row.kind === "assistant") {
        const output = expandImageResults(this.restoreToolResults(String(row.turn_id), array(row.output ?? "[]")), this.images);
        const covered = checkpoint?.turn_id === row.turn_id ? Number(checkpoint.output_count) : 0;
        const suffix = output.slice(covered);
        if (row.status === "completed" && output.length) {
          const sameScope = row.account_key === accountKey && (!settings || JSON.parse(String(row.settings)).modelId === settings.modelId);
          if (sameScope) input.push(...suffix);
          else if (covered) input.push(...portableInput(suffix));
          else {
            input.push({ role: "assistant", content: [{ type: "output_text", text: row.text }] });
            input.push(...portableToolImages(suffix));
          }
        } else {
          input.push({ role: "assistant", content: [{ type: "output_text", text: `${row.text}${row.status !== "completed" ? "\n[Response interrupted.]" : ""}` }] });
          input.push(...portableToolImages(suffix));
        }
      }
    }
    const active = this.db.prepare("SELECT id,settings,account_key,output FROM turns WHERE status='running' AND operation='response'").get();
    if (active) {
      const output = expandImageResults(this.restoreToolResults(String(active.id), array(active.output)), this.images).slice(checkpoint?.turn_id === active.id ? Number(checkpoint.output_count) : 0);
      const sameScope = active.account_key === accountKey && (!settings || JSON.parse(String(active.settings)).modelId === settings.modelId);
      input.push(...(sameScope ? output : portableInput(output)));
    }
    const checkpointId = checkpoint ? String(checkpoint.id) : null;
    const meter = this.db.prepare(`SELECT context,context_projection,settings FROM turns
      WHERE status='completed' AND account_key=? AND context IS NOT NULL AND context_projection IS NOT NULL
      ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(accountKey);
    let tokenAnchor: CompactionCapture["tokenAnchor"];
    if (meter && (!settings || JSON.parse(String(meter.settings)).modelId === settings.modelId)) {
      const context = JSON.parse(String(meter.context)), projection = JSON.parse(String(meter.context_projection));
      const ledgerTokens = projection.ledgerTokens ?? 0;
      const overhead = projection.overhead ?? 0;
      if (projection.checkpointId === checkpointId && Number.isSafeInteger(projection.count) && projection.count >= 0 && projection.count <= input.length
        && Number.isSafeInteger(context.estimatedTokens) && context.estimatedTokens >= 0
        && Number.isSafeInteger(ledgerTokens) && ledgerTokens >= 0
        && Number.isSafeInteger(overhead) && overhead >= 0
        && outputDigest(input.slice(0, projection.count)) === projection.digest) tokenAnchor = { tokens: context.estimatedTokens, count: projection.count, ledgerTokens, overhead };
    }
    return { leafId: current.leafId, checkpointId, input,
      compactionCount: checkpoints.length, lastCompactedAt: checkpoint ? Number(checkpoint.created_at) : null, ...(tokenAnchor ? { tokenAnchor } : {}) };
  }
  save(value: CompactionSave): Info {
    if (!value.summary.trim() || Buffer.byteLength(value.summary) > 1024 * 1024) throw invalid("Compaction must produce a nonempty summary within 1 MiB.");
    if (!Array.isArray(value.kept) || Buffer.byteLength(JSON.stringify(value.kept)) > 64 * 1024 * 1024) throw invalid("The retained compaction window exceeds its storage limit.");
    if (!value.modelId || !value.accountKey || !["auto", "manual", "overflow"].includes(value.trigger)
      || ![value.tokensBefore, value.tokensAfter].every(count => Number.isSafeInteger(count) && count >= 0)) throw invalid("Invalid compaction metadata.");
    try { assertCompleteTools(value.kept); } catch { throw invalid("Compaction cannot split a tool call and its result."); }
    return this.transaction(() => {
      const current = this.read();
      const ancestry = new Set(this.chain(current.leafId));
      const latest = this.checkpoints(ancestry)[0];
      if (current.leafId !== value.expectedLeafId || (latest ? String(latest.id) : null) !== value.previousId) throw conflict();
      let count = 0, digest: string | null = null;
      if (value.turnId !== undefined) {
        const turn = this.db.prepare("SELECT status,output FROM turns WHERE id=?").get(value.turnId);
        count = value.outputCount ?? 0;
        if (!turn || turn.status !== "running" || !Number.isSafeInteger(count) || count < 0) throw conflict();
        const output = array(turn.output);
        if (output.length !== count) throw conflict();
        digest = outputDigest(output);
        if (value.outputDigest !== undefined && value.outputDigest !== digest) throw conflict();
        try { assertCompleteTools(output); } catch { throw invalid("Finish all tool results before compacting this turn."); }
      } else if (value.outputCount !== undefined && value.outputCount !== 0) throw invalid("A compaction output offset requires an active turn.");
      const row = { id: randomUUID(), leaf_id: current.leafId, created_at: Date.now(), summary: value.summary,
        model_id: value.modelId, tokens_before: value.tokensBefore, tokens_after: value.tokensAfter, trigger: value.trigger };
      this.db.prepare(`INSERT INTO compactions(id,previous_id,leaf_id,turn_id,output_count,output_digest,summary,kept,model_id,account_key,tokens_before,tokens_after,trigger,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, value.previousId, current.leafId, value.turnId ?? null, count, digest,
          value.summary, JSON.stringify(value.kept), value.modelId, value.accountKey, value.tokensBefore, value.tokensAfter, value.trigger, row.created_at);
      return this.info(row);
    });
  }
}
