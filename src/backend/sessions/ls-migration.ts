import type { DatabaseSync } from "node:sqlite";
import { storageError } from "./files.js";

export function migrateLs(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 6) { db.exec("COMMIT"); return; }
    if (version !== 5) throw storageError();
    db.exec(`CREATE TABLE file_operations_v6 (
      turn_id TEXT NOT NULL REFERENCES turns(id),
      call_id TEXT NOT NULL,
      name TEXT NOT NULL CHECK(name IN ('ls','read','edit','write')),
      path TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      result TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(turn_id,call_id)
    );
    INSERT INTO file_operations_v6(rowid,turn_id,call_id,name,path,fingerprint,result,created_at)
      SELECT rowid,turn_id,call_id,name,path,fingerprint,result,created_at FROM file_operations;
    DROP TABLE file_operations;
    ALTER TABLE file_operations_v6 RENAME TO file_operations;
    PRAGMA user_version=6;`);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
