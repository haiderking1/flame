import type { DatabaseSync } from "node:sqlite";
import { storageError } from "./files.js";

export function migrateFileTools(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 5) { db.exec("COMMIT"); return; }
    if (version !== 4) throw storageError();
    db.exec(`CREATE TABLE file_operations (
      turn_id TEXT NOT NULL REFERENCES turns(id),
      call_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(name IN ('read','edit','write')),
      path TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(turn_id,call_id)
    );
    PRAGMA user_version=5;`);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
