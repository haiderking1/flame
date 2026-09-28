import type { DatabaseSync } from "node:sqlite";

export function migrateSettlement(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("PRAGMA user_version").get()?.user_version === 3) {
      db.exec("ALTER TABLE session ADD COLUMN settled_at INTEGER CHECK(settled_at IS NULL OR settled_at >= 0); PRAGMA user_version=4;");
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
