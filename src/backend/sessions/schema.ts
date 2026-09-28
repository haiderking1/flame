import type { DatabaseSync } from "node:sqlite";
import type { SessionLocation } from "../../contracts/sessions.js";
import type { ModelSelection } from "../../contracts/models.js";

export function initializeSession(db: DatabaseSync, location: SessionLocation, settings: ModelSelection | null) {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE entries (
      id TEXT PRIMARY KEY NOT NULL,
      parent_id TEXT REFERENCES entries(id),
      created_at INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('user', 'settings')),
      text TEXT,
      settings TEXT NOT NULL CHECK(json_valid(settings)),
      request_id TEXT UNIQUE,
      CHECK((kind = 'user' AND text IS NOT NULL AND request_id IS NOT NULL) OR (kind = 'settings' AND text IS NULL))
    ) STRICT;
    CREATE INDEX entries_parent ON entries(parent_id);
    CREATE TABLE session (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)),
      custom_title INTEGER NOT NULL DEFAULT 0 CHECK(custom_title IN (0, 1)),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      revision INTEGER NOT NULL CHECK(revision >= 0), draft TEXT NOT NULL,
      settings TEXT NOT NULL CHECK(json_valid(settings)), leaf_id TEXT REFERENCES entries(id)
    ) STRICT;
    PRAGMA user_version = 1;`);
  const now = Date.now();
  db.prepare(`INSERT INTO session(singleton, id, project_id, title, created_at, updated_at, revision, draft, settings)
    VALUES (1, ?, ?, 'New session', ?, ?, 0, '', ?)`).run(location.sessionId, location.projectId, now, now, JSON.stringify(settings));
  db.exec("COMMIT");
}
