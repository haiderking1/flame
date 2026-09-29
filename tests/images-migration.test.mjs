import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateImages } from '../dist/backend/sessions/images-migration.js';

test('image migration preserves entry/file operation identities, adds image foreign keys, and is idempotent', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE entries(id TEXT PRIMARY KEY,text TEXT); INSERT INTO entries VALUES ('old','History'); CREATE TABLE file_operations(id TEXT PRIMARY KEY); INSERT INTO file_operations VALUES ('saved-tool'); PRAGMA user_version=6;");
  migrateImages(db); migrateImages(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.equal(db.prepare('SELECT text FROM entries').get().text, 'History');
  assert.equal(db.prepare('SELECT id FROM file_operations').get().id, 'saved-tool');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM images').get().count, 0);
  assert.throws(() => db.prepare("INSERT INTO entry_images VALUES ('missing-entry','missing-image',0)").run(), /FOREIGN KEY/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('failed image migration rolls back every newly created table and the version', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE entries(id TEXT PRIMARY KEY); CREATE TABLE image_uploads(sentinel TEXT); PRAGMA user_version=6;');
  assert.throws(() => migrateImages(db), /already exists/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('images','entry_images','image_chunks')").get().count, 0);
  assert.equal(db.isTransaction, false);
});
