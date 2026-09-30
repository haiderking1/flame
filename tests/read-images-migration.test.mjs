import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateReadImages } from '../dist/backend/sessions/read-images-migration.js';

function database(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE images(id TEXT PRIMARY KEY);
    CREATE TABLE file_operations(turn_id TEXT,call_id TEXT,name TEXT,path TEXT,fingerprint TEXT,result TEXT,created_at INTEGER,PRIMARY KEY(turn_id,call_id));
    INSERT INTO file_operations VALUES ('turn','read','read','source','hash','{"status":"completed","content":"old text"}',123);
    INSERT INTO file_operations VALUES ('turn','write','write','target','hash',NULL,124);
    PRAGMA user_version=8;`);
  return db;
}
test('v8 to v9 preserves rowids, saved results, unfinished claims, and enforces unique Read image ownership', t => {
  const db = database(t), before = db.prepare('SELECT rowid,* FROM file_operations ORDER BY rowid').all();
  migrateReadImages(db); migrateReadImages(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 9);
  const after = db.prepare('SELECT rowid,* FROM file_operations ORDER BY rowid').all();
  assert.deepEqual(after.map(({ image_id, ...row }) => row), before.map(row => ({ ...row }))); assert.ok(after.every(row => row.image_id === null));
  assert.throws(() => db.prepare("UPDATE file_operations SET image_id='missing' WHERE call_id='read'").run(), /FOREIGN KEY/);
  db.exec("INSERT INTO images VALUES ('saved'); UPDATE file_operations SET image_id='saved' WHERE call_id='read';");
  assert.throws(() => db.prepare("UPDATE file_operations SET image_id='saved' WHERE call_id='write'").run(), /CHECK/);
  assert.throws(() => db.prepare("DELETE FROM images WHERE id='saved'").run(), /FOREIGN KEY/);
  db.exec("INSERT INTO file_operations(turn_id,call_id,name) VALUES ('turn','other','read');");
  assert.throws(() => db.prepare("UPDATE file_operations SET image_id='saved' WHERE call_id='other'").run(), /UNIQUE/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
test('failed image-read migration rolls back both the new column and version', t => {
  const db = database(t); db.exec('CREATE INDEX file_operations_image ON file_operations(path);');
  assert.throws(() => migrateReadImages(db), /already exists/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 8);
  assert.ok(!db.prepare('PRAGMA table_info(file_operations)').all().some(row => row.name === 'image_id'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM file_operations').get().count, 2);
  assert.equal(db.isTransaction, false);
});
