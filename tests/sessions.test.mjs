import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, chmodSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { SessionDatabase } from '../dist/backend/sessions/database.js';
import { Sessions } from '../dist/backend/sessions/service.js';
import { fitsSessionText } from '../dist/contracts/sessions.js';

const settings = { modelId: 'test-model', effort: 'high', serviceTier: 'default' };
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'flame-sessions-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const a = projects.add(join(root, 'work-a'));
  const b = projects.add(join(root, 'work-b'));
  const repository = new SessionRepository(join(root, 'projects'), projects);
  const location = (projectId = a.id) => ({ projectId, sessionId: randomUUID() });
  const file = (loc) => join(root, 'projects', loc.projectId, 'sessions', loc.sessionId, 'session.sqlite');
  t.after(() => { projects.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, projects, a, b, repository, location, file };
}

test('sessions own separate SQLite databases nested under projects, survive restart and create retries', (t) => {
  const h = setup(t);
  const a = h.location(), b = h.location(), other = { ...a, projectId: h.b.id };
  const first = h.repository.create(a, settings);
  h.repository.create(b, null); h.repository.create(other, null);
  const written = h.repository.use(a, (db) => db.append(0, randomUUID(), 'Only in the first session'));
  assert.equal(written.title, 'Only in the first session');
  assert.equal(h.repository.use(b, (db) => db.history(null)).entries.length, 0);
  assert.equal(h.repository.use(other, (db) => db.history(null)).entries.length, 0);
  assert.equal(h.repository.create(a, null).revision, written.revision, 'retry does not reset a session');
  const restarted = new SessionRepository(join(h.root, 'projects'), h.projects);
  assert.equal(restarted.list().sessions.length, 3);
  assert.deepEqual(restarted.use(a, (db) => db.read()).settings, first.settings);
  for (const loc of [a, b, other]) {
    assert.ok(statSync(h.file(loc)).isFile());
    if (process.platform !== 'win32') assert.equal(statSync(h.file(loc)).mode & 0o777, 0o600);
  }
});

test('message retries are idempotent, mismatched replay is rejected, and later drafts are not erased', (t) => {
  const h = setup(t), location = h.location(), requestId = randomUUID();
  h.repository.create(location, settings);
  h.repository.use(location, (db) => {
    let doc = db.draft(0, 'Hello');
    const revision = doc.revision;
    doc = db.append(revision, requestId, 'Hello');
    assert.equal(doc.draft, '');
    doc = db.draft(doc.revision, 'A later draft');
    assert.equal(db.append(revision, requestId, 'Hello').draft, 'A later draft');
    assert.equal(db.history(null).entries.length, 1);
    assert.throws(() => db.append(doc.revision, requestId, 'Different text'), /already used/);
    assert.throws(() => db.draft(0, 'Stale edit'), /changed elsewhere/);
    assert.equal(db.read().draft, 'A later draft');
    assert.throws(() => db.append(doc.revision, randomUUID(), '  '), /must contain text/);
    assert.equal(db.read().revision, doc.revision);
  });
});

test('independent writers cannot overwrite each other and deletion fences existing connections', (t) => {
  const h = setup(t), location = h.location();
  h.repository.create(location, null);
  const first = new SessionDatabase(h.file(location), location);
  const second = new SessionDatabase(h.file(location), location);
  try {
    const doc = first.draft(0, 'saved draft');
    assert.throws(() => second.draft(0, 'overwrite'), /changed elsewhere/);
    assert.throws(() => second.append(0, randomUUID(), 'stale message'), /changed elsewhere/);
    first.retire(doc.revision);
    assert.throws(() => second.append(doc.revision, randomUUID(), 'after deletion'), /no longer exists/);
  } finally { first.close(); second.close(); }
  assert.equal(h.repository.list().sessions.length, 0, 'startup discovery finishes the interrupted deletion');
  h.repository.remove(location, 1);
  h.repository.remove(location, 1);
  assert.equal(h.repository.list().sessions.length, 0);
  assert.throws(() => h.repository.create(location, null), /no longer exists/);
  assert.ok(statSync(join(h.root, 'projects', location.projectId, 'sessions', '.trash', location.sessionId, 'session.sqlite')).isFile());
});

test('history is append-only, parent-linked, paginated and preserves model settings snapshots', (t) => {
  const h = setup(t), location = h.location();
  h.repository.create(location, settings);
  h.repository.use(location, (db) => {
    let doc = db.read();
    for (let i = 0; i < 65; i++) doc = db.append(doc.revision, randomUUID(), `Message ${i}`);
    const newer = db.history(null), older = db.history(newer.nextBefore), oldest = db.history(older.nextBefore);
    const entries = [...oldest.entries, ...older.entries, ...newer.entries];
    assert.equal(entries.length, 65);
    assert.equal(oldest.nextBefore, null);
    assert.equal(entries[0].parentId, null);
    for (let i = 1; i < entries.length; i++) assert.equal(entries[i].parentId, entries[i - 1].id);
    assert.equal(entries[64].id, doc.leafId);
    doc = db.configure(doc.revision, { ...settings, effort: 'low', serviceTier: 'priority' });
    doc = db.append(doc.revision, randomUUID(), 'With new settings');
    const tail = db.history(null).entries;
    assert.equal(tail.at(-2).kind, 'settings');
    assert.equal(tail.at(-1).settings.serviceTier, 'priority');
    assert.equal(tail.at(-3).settings.serviceTier, 'default');
    assert.equal(doc.title, 'Message 0', 'later messages do not rename the session');
    doc = db.rename(doc.revision, '  A real title  ');
    assert.equal(doc.title, 'A real title');
    assert.throws(() => db.rename(doc.revision, '  '), /names must/);
    assert.throws(() => db.history(randomUUID()), /no longer exists/);
  });
});

test('path traversal, foreign projects, unsafe symlinks and mismatched database identity are rejected', (t) => {
  const h = setup(t), location = h.location();
  h.repository.create(location, null);
  assert.throws(() => h.repository.create({ ...location, sessionId: '../escape' }, null), /Invalid/);
  assert.throws(() => h.repository.create(h.location(randomUUID()), null), /no longer exists/);
  const copy = h.location();
  const directory = join(h.root, 'projects', copy.projectId, 'sessions', copy.sessionId);
  mkdirSync(directory, { mode: 0o700 }); copyFileSync(h.file(location), h.file(copy));
  assert.throws(() => h.repository.use(copy, (db) => db.read()), /safely/);
  if (process.platform !== 'win32') {
    const link = h.location();
    symlinkSync(join(directory, '..', location.sessionId), join(directory, '..', link.sessionId));
    assert.throws(() => h.repository.use(link, (db) => db.read()), /safely/);
    chmodSync(h.file(location), 0o644);
    assert.throws(() => h.repository.use(location, (db) => db.read()), /safely/);
    chmodSync(h.file(location), 0o600);
  }
});

test('corrupt and future-version sessions do not hide healthy sessions or get silently rewritten', (t) => {
  const h = setup(t), healthy = h.location(), future = h.location();
  h.repository.create(healthy, null); h.repository.create(future, null);
  const raw = new DatabaseSync(h.file(future)); raw.exec('PRAGMA user_version=99'); raw.close();
  const orphan = join(h.root, 'projects', healthy.projectId, 'sessions', '.incomplete.creating');
  mkdirSync(orphan, { mode: 0o700 });
  const index = h.repository.list();
  assert.equal(index.sessions.length, 1); assert.equal(index.warnings.length, 1);
  assert.equal(index.sessions[0].sessionId, healthy.sessionId);
  assert.ok(readdirSync(join(orphan, '..')).includes('.incomplete.creating'));
  const unchanged = new DatabaseSync(h.file(future));
  assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version, 99); unchanged.close();
});

test('session configuration uses provider validation and does not change account defaults', (t) => {
  const h = setup(t), location = h.location();
  const models = { state: { selection: settings, accountKey: 'account' }, validateSelection(account, value) {
    if (account !== 'account' || value.effort === 'invented') throw new Error('invalid settings');
    return value;
  } };
  const service = new Sessions(h.repository, models);
  const created = service.create(location);
  const configured = service.configure(location, created.revision, 'account', { ...settings, effort: 'low' });
  assert.equal(configured.settings.effort, 'low'); assert.equal(models.state.selection.effort, 'high');
  assert.throws(() => service.configure(location, configured.revision, 'foreign', settings));
  assert.throws(() => service.configure(location, configured.revision, 'account', { ...settings, effort: 'invented' }));
  assert.equal(service.read(location).revision, configured.revision);
});

test('failed transactions and failed creation leave no partial history or published session', (t) => {
  const h = setup(t), location = h.location();
  assert.throws(() => h.repository.create(location, { ...settings, serviceTier: 'invalid' }));
  assert.equal(h.repository.list().sessions.length, 0);
  assert.deepEqual(readdirSync(join(h.root, 'projects', location.projectId, 'sessions')), []);
  h.repository.create(location, null);
  const raw = new DatabaseSync(h.file(location));
  raw.exec("CREATE TRIGGER fail_entry AFTER INSERT ON entries BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END");
  const requestId = randomUUID();
  h.repository.use(location, (db) => {
    const before = db.draft(0, 'Keep this draft');
    assert.throws(() => db.append(before.revision, requestId, before.draft));
    assert.deepEqual(db.read(), before);
    assert.equal(db.history(null).entries.length, 0);
    raw.exec('DROP TRIGGER fail_entry');
    assert.equal(db.append(before.revision, requestId, before.draft).draft, '');
    assert.equal(db.history(null).entries.length, 1);
  });
  raw.close();
});

test('encoded text bounds account for Unicode and JSON escaping and failed saves preserve prior state', (t) => {
  const h = setup(t), location = h.location(); h.repository.create(location, null);
  assert.equal(fitsSessionText('😀'.repeat(13000)), false);
  assert.equal(fitsSessionText('\u0000'.repeat(9000)), false);
  assert.equal(fitsSessionText('A normal draft'), true);
  h.repository.use(location, (db) => {
    const saved = db.draft(0, 'Keep me');
    assert.throws(() => db.draft(saved.revision, 'x'.repeat(50000)), /limit/);
    assert.deepEqual(db.read(), saved);
  });
});
