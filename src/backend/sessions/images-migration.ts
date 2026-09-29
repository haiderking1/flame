import type { DatabaseSync } from "node:sqlite";
import { storageError } from "./files.js";
export function migrateImages(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 7) { db.exec("COMMIT"); return; }
    if (version !== 6) throw storageError();
    db.exec(`CREATE TABLE images (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, source_hash TEXT NOT NULL, source_bytes INTEGER NOT NULL,
      mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
      model_mime TEXT NOT NULL, model_width INTEGER NOT NULL, model_height INTEGER NOT NULL,
      model_bytes INTEGER NOT NULL, model_hash TEXT NOT NULL
    );
    CREATE TABLE entry_images (entry_id TEXT NOT NULL REFERENCES entries(id), image_id TEXT NOT NULL REFERENCES images(id),
      position INTEGER NOT NULL, PRIMARY KEY(entry_id,position), UNIQUE(entry_id,image_id));
    CREATE TABLE image_uploads (id TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL, bytes INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE image_chunks (id TEXT NOT NULL REFERENCES image_uploads(id) ON DELETE CASCADE, offset INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(id,offset));
    PRAGMA user_version=7;`);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
