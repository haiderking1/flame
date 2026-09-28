import type { DatabaseSync } from "node:sqlite";

// Rebuild the entry constraint without rewriting IDs or breaking either foreign key.
export function migrateSession(db: DatabaseSync) {
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
  try {
    db.exec(`CREATE TABLE entries_next (
      id TEXT PRIMARY KEY NOT NULL, parent_id TEXT REFERENCES entries_next(id), created_at INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('user','settings','assistant')), text TEXT,
      settings TEXT NOT NULL CHECK(json_valid(settings)), request_id TEXT UNIQUE,
      CHECK((kind='user' AND text IS NOT NULL AND request_id IS NOT NULL)
        OR (kind='settings' AND text IS NULL) OR (kind='assistant' AND text IS NOT NULL AND request_id IS NULL))
    ) STRICT;
    INSERT INTO entries_next SELECT * FROM entries;
    DROP TABLE entries;
    ALTER TABLE entries_next RENAME TO entries;
    CREATE INDEX entries_parent ON entries(parent_id);
    CREATE TABLE turns (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL UNIQUE REFERENCES entries(id),
      status TEXT NOT NULL CHECK(status IN ('running','completed','cancelled','failed','interrupted')),
      settings TEXT NOT NULL CHECK(json_valid(settings)), account_key TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(output)), message TEXT,
      revision INTEGER NOT NULL, entry_id TEXT UNIQUE REFERENCES entries(id), created_at INTEGER NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX one_running_turn ON turns(status) WHERE status='running';
    PRAGMA user_version=2;`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Invalid session references");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.exec("PRAGMA foreign_keys=ON"); }
}
