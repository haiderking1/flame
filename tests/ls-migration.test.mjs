import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { migrateFileTools } from '../dist/backend/sessions/file-tools-migration.js';
import { migrateLs } from '../dist/backend/sessions/ls-migration.js';

function database(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE turns(id TEXT PRIMARY KEY); INSERT INTO turns VALUES ('turn'); PRAGMA user_version=4;");
  migrateFileTools(db);
  return db;
}

test('v5 to v6 preserves saved and unfinished operations and row ordering while allowing ls', t => {
  const db = database(t);
  const insert = db.prepare('INSERT INTO file_operations(rowid,turn_id,call_id,name,path,fingerprint,result,created_at) VALUES (?,\'turn\',?,?,?,?,?,100)');
  insert.run(7, 'saved', 'write', 'file', 'fingerprint-1', JSON.stringify({ status: 'completed', path: 'file', summary: 'Saved' }));
  insert.run(19, 'pending', 'edit', 'file', 'fingerprint-2', null);
  const before = db.prepare('SELECT rowid,* FROM file_operations ORDER BY rowid').all();
  assert.throws(() => insert.run(20, 'list', 'ls', '.', 'fingerprint-3', null), /CHECK/);
  migrateLs(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 6);
  assert.deepEqual(db.prepare('SELECT rowid,* FROM file_operations ORDER BY rowid').all(), before);
  db.prepare("INSERT INTO file_operations(turn_id,call_id,name,path,fingerprint,created_at) VALUES ('turn','list','ls','.','fingerprint-3',101)").run();
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare("INSERT INTO file_operations(turn_id,call_id,name,path,fingerprint,created_at) VALUES ('turn','bad','unknown','.','x',1)").run(), /CHECK/);
  migrateLs(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM file_operations').get().count, 3);
});

test('failed ls migration rolls back schema, version, and all existing operation rows', t => {
  const db = database(t);
  db.exec("PRAGMA ignore_check_constraints=ON; INSERT INTO file_operations VALUES ('turn','bad','unknown','.','hash',NULL,1); PRAGMA ignore_check_constraints=OFF;");
  assert.throws(() => migrateLs(db), /CHECK/);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  assert.equal(db.prepare('SELECT name FROM file_operations').get().name, 'unknown');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='file_operations_v6'").get().count, 0);
  assert.equal(db.isTransaction, false);
});
