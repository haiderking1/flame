import type { DatabaseSync } from "node:sqlite";
import { storageError } from "./files.js";

export function migrateReadImages(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 9) { db.exec("COMMIT"); return; }
    if (version !== 8) throw storageError();
    db.exec(`ALTER TABLE file_operations ADD COLUMN image_id TEXT REFERENCES images(id) CHECK(image_id IS NULL OR name='read');
      CREATE UNIQUE INDEX file_operations_image ON file_operations(image_id) WHERE image_id IS NOT NULL;
      PRAGMA user_version=9;`);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw storageError();
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
