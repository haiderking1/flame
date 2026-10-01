import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { storageError } from "./files.js";

/**
 * Version 11 records who wrote each session's title. A title already taken from a first message or renamed counts as
 * the user's, so the text model never retitles an existing conversation on its own.
 */
export function migrateTitles(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 11) { db.exec("COMMIT"); return; }
    if (version !== 10) throw storageError();
    db.exec("ALTER TABLE session ADD COLUMN title_state TEXT CHECK(title_state IS NULL OR json_valid(title_state))");
    const custom = db.prepare("SELECT custom_title FROM session WHERE singleton=1").get()?.custom_title === 1;
    db.prepare("UPDATE session SET title_state=? WHERE singleton=1")
      .run(JSON.stringify({ source: custom ? "manual" : "auto", version: randomUUID(), needsRefinement: false, regeneration: null }));
    db.exec("PRAGMA user_version=11");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
