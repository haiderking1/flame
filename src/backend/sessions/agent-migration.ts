import type { DatabaseSync } from "node:sqlite";
import { storageError } from "./files.js";

/**
 * Version 12 lets a session be a subagent of another thread (its agent record, with the conversation it was forked
 * from), and gives every session a mailbox for messages between agents.
 */
export function migrateAgents(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 12) { db.exec("COMMIT"); return; }
    if (version !== 11) throw storageError();
    db.exec(`CREATE TABLE agent (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        root_session_id TEXT NOT NULL, parent_session_id TEXT NOT NULL, path TEXT NOT NULL, nickname TEXT NOT NULL,
        task TEXT NOT NULL, created_at INTEGER NOT NULL, fork TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(fork))
      ) STRICT;
      CREATE TABLE mailbox (
        id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('task', 'message', 'final')), sender TEXT NOT NULL, text TEXT NOT NULL,
        delivered_at INTEGER
      ) STRICT;
      CREATE INDEX mailbox_pending ON mailbox(created_at) WHERE delivered_at IS NULL;
      PRAGMA user_version=12;`);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
