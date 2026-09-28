import type { DatabaseSync } from "node:sqlite";
export function migrateBash(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    // Background completions can start another turn attached to the same user
    // entry. They do not manufacture user messages or overwrite prior turns.
    db.exec(`CREATE TABLE turns_next (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL REFERENCES entries(id),
      status TEXT NOT NULL CHECK(status IN ('running','completed','cancelled','failed','interrupted')),
      settings TEXT NOT NULL CHECK(json_valid(settings)), account_key TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
      output TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(output)), message TEXT,
      revision INTEGER NOT NULL, entry_id TEXT UNIQUE REFERENCES entries(id), created_at INTEGER NOT NULL
    ) STRICT;
    INSERT INTO turns_next SELECT * FROM turns;
    DROP TABLE turns;
    ALTER TABLE turns_next RENAME TO turns;
    CREATE UNIQUE INDEX one_running_turn ON turns(status) WHERE status='running';
    CREATE TABLE bash_jobs (
      id TEXT PRIMARY KEY NOT NULL, turn_id TEXT NOT NULL REFERENCES turns(id), call_id TEXT NOT NULL,
      data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(turn_id,call_id)
    ) STRICT;
    PRAGMA user_version=3;`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Invalid Bash references");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
