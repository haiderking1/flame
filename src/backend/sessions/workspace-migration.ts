import type { DatabaseSync } from "node:sqlite";
import { LOCAL_WORKSPACE } from "../../contracts/session-workspace.js";
import { storageError } from "./files.js";

/** Version 10 records where each session works (project checkout or worktree) and its latest worktree setup. */
export function migrateWorkspace(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 10) { db.exec("COMMIT"); return; }
    if (version !== 9) throw storageError();
    db.exec(`ALTER TABLE session ADD COLUMN workspace TEXT NOT NULL DEFAULT '${JSON.stringify(LOCAL_WORKSPACE)}' CHECK(json_valid(workspace));
      ALTER TABLE session ADD COLUMN workspace_setup TEXT CHECK(workspace_setup IS NULL OR json_valid(workspace_setup));
      PRAGMA user_version=10;`);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
