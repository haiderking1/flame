import type { DatabaseSync } from "node:sqlite";
import { FileToolError, type FileResult } from "./types.js";
import type { ImageStore } from "../images/store.js";
import type { ReadImage } from "./read-file.js";

export class FileOperationStore {
  constructor(private db: DatabaseSync, private assertOpen: () => unknown,
    private transaction: <T>(work: () => T) => T, private images: ImageStore) {}
  claim(turnId: string, callId: string, name: string, path: string, fingerprint: string): FileResult | null {
    this.assertOpen();
    const prior = this.db.prepare("SELECT fingerprint,result FROM file_operations WHERE turn_id=? AND call_id=?").get(turnId, callId);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new FileToolError("Tool call identifier was reused with different arguments. Nothing was replayed.");
      return prior.result ? JSON.parse(String(prior.result)) as FileResult : {
        status: "uncertain", path, summary: "This operation was already claimed, but its outcome was not saved.",
        error: name === "ls" || name === "read"
          ? "The read-only result was not saved. No files were changed by this operation; it will not be replayed."
          : "The operation may have completed before interruption. Inspect the file; it will not be replayed.",
      };
    }
    const turn = this.db.prepare("SELECT status FROM turns WHERE id=?").get(turnId);
    if (turn?.status !== "running") throw new FileToolError("The turn is no longer running. No file operation was started.");
    if (Number(this.db.prepare("SELECT COUNT(*) AS count FROM file_operations").get()?.count) >= 1024) throw new FileToolError("This session reached its 1024 file-operation limit. Start a new session.");
    this.db.prepare("INSERT INTO file_operations(turn_id,call_id,name,path,fingerprint,created_at) VALUES (?,?,?,?,?,?)").run(turnId, callId, name, path, fingerprint, Date.now());
    return null;
  }
  finish(turnId: string, callId: string, result: FileResult, image?: ReadImage) {
    this.assertOpen();
    this.transaction(() => {
      if (Boolean(image) !== Boolean(result.image) || result.image && result.status !== "completed") throw new Error("Invalid image read result.");
      const claim = this.db.prepare("SELECT name,result FROM file_operations WHERE turn_id=? AND call_id=?").get(turnId, callId);
      if (!claim || claim.result !== null || image && claim.name !== "read") throw new Error("File operation outcome could not be recorded.");
      if (image && result.image) this.images.saveRead(result.image, image.original, image.prepared);
      const saved = this.db.prepare("UPDATE file_operations SET result=?,image_id=? WHERE turn_id=? AND call_id=? AND result IS NULL")
        .run(JSON.stringify(result), result.image?.id ?? null, turnId, callId);
      if (saved.changes !== 1) throw new Error("File operation outcome could not be recorded.");
    });
  }
  restoreResults(turnId: string, output: unknown[]): unknown[] {
    this.assertOpen();
    const calls = new Set<string>(), results = new Set<string>();
    for (const value of output) {
      if (!value || typeof value !== "object" || !("call_id" in value) || typeof value.call_id !== "string" || !("type" in value)) continue;
      if (value.type === "function_call") calls.add(value.call_id);
      if (value.type === "function_call_output") results.add(value.call_id);
    }
    const restored = [...output];
    for (const row of this.db.prepare("SELECT call_id,result FROM file_operations WHERE turn_id=? AND result IS NOT NULL").all(turnId)) {
      const id = String(row.call_id);
      if (calls.has(id) && !results.has(id)) restored.push({ type: "function_call_output", call_id: id, output: String(row.result) });
    }
    return restored;
  }
  ledger() {
    this.assertOpen();
    return this.db.prepare("SELECT name,path,result FROM file_operations WHERE name IN ('edit','write') ORDER BY created_at DESC,rowid DESC LIMIT 20").all().reverse().map(row => {
      const result = row.result ? JSON.parse(String(row.result)) as FileResult : null;
      return { name: row.name, path: String(row.path).slice(0, 1024), status: result?.status ?? "uncertain", summary: result?.summary,
        error: result?.error ?? (result ? undefined : "Outcome not saved; inspect before continuing. Do not replay."), sha256: result?.sha256 };
    });
  }
}
