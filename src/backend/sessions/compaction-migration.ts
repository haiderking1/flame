import type { DatabaseSync } from "node:sqlite";
import { storageError } from "./files.js";

export function migrateCompaction(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 8) { db.exec("COMMIT"); return; }
    if (version !== 7) throw storageError();
    db.exec(`ALTER TABLE turns ADD COLUMN operation TEXT NOT NULL DEFAULT 'response' CHECK(operation IN ('response','compaction'));
      ALTER TABLE turns ADD COLUMN phase TEXT NOT NULL DEFAULT 'responding' CHECK(phase IN ('responding','compacting'));
      ALTER TABLE turns ADD COLUMN context TEXT CHECK(context IS NULL OR json_valid(context));
      ALTER TABLE turns ADD COLUMN context_projection TEXT CHECK(context_projection IS NULL OR json_valid(context_projection));
      CREATE TABLE compactions (
        id TEXT PRIMARY KEY NOT NULL, previous_id TEXT REFERENCES compactions(id),
        leaf_id TEXT REFERENCES entries(id), turn_id TEXT REFERENCES turns(id),
        output_count INTEGER NOT NULL DEFAULT 0 CHECK(output_count >= 0), output_digest TEXT,
        summary TEXT NOT NULL CHECK(length(summary)>0), kept TEXT NOT NULL CHECK(json_valid(kept)),
        model_id TEXT NOT NULL, account_key TEXT NOT NULL,
        tokens_before INTEGER NOT NULL CHECK(tokens_before>=0), tokens_after INTEGER NOT NULL CHECK(tokens_after>=0),
        trigger TEXT NOT NULL CHECK(trigger IN ('auto','manual','overflow')), created_at INTEGER NOT NULL,
        CHECK((turn_id IS NULL AND output_count=0 AND output_digest IS NULL) OR (turn_id IS NOT NULL AND output_digest IS NOT NULL))
      ) STRICT;
      CREATE INDEX compactions_leaf ON compactions(leaf_id);
      PRAGMA user_version=8;`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw storageError();
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
