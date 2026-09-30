import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProjectStore } from '../dist/backend/projects/store.js';
import { SessionRepository } from '../dist/backend/sessions/repository.js';
import { Sessions } from '../dist/backend/sessions/service.js';

const settings = { modelId: 'test-model', effort: 'high', serviceTier: 'default' };
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'flame-settlement-'));
  const projects = new ProjectStore(join(root, 'flame.sqlite'));
  const project = projects.add(join(root, 'work'));
  const repository = new SessionRepository(join(root, 'projects'), projects);
  const location = { projectId: project.id, sessionId: randomUUID() };
  repository.create(location, settings);
  t.after(() => { projects.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, projects, repository, location, file: join(root, 'projects', project.id, 'sessions', location.sessionId, 'session.sqlite') };
}

test('settlement is durable, revision guarded, reversible, and preserves drafts, settings and history', t => {
  const h = setup(t);
  const sessions = new Sessions(h.repository, { state: {}, validateSelection: () => settings });
  let changes = 0; sessions.on('change', () => changes++);
  const sent = sessions.append(h.location, 0, randomUUID(), 'Saved conversation');
  const drafted = sessions.draft(h.location, sent.revision, 'Unsent text');
  const settled = sessions.settle(h.location, drafted.revision, true);
  assert.ok(settled.settledAt > 0);
  assert.equal(settled.updatedAt, drafted.updatedAt, 'settling is not new conversation activity');
  assert.equal(settled.draft, 'Unsent text');
  assert.deepEqual(settled.settings, settings);
  assert.equal(changes, 3);
  assert.equal(sessions.snapshot().sessions[0].settledAt, settled.settledAt);
  assert.throws(() => sessions.settle(h.location, drafted.revision, false), /changed elsewhere/);
  assert.equal(sessions.settle(h.location, settled.revision, true).revision, settled.revision);
  const restarted = new SessionRepository(join(h.root, 'projects'), h.projects);
  assert.equal(restarted.list().sessions[0].settledAt, settled.settledAt);
  restarted.use(h.location, db => {
    assert.equal(db.history(null).entries.length, 1);
    const renamed = db.rename(db.read().revision, 'Renamed');
    const edited = db.draft(renamed.revision, 'Still a draft');
    assert.equal(edited.settledAt, settled.settledAt, 'opening, renaming and draft changes do not reactivate');
    const restored = db.settle(edited.revision, false);
    assert.equal(restored.settledAt, null);
    assert.equal(restored.draft, 'Still a draft');
  });
});

test('only new accepted messages reactivate; duplicate or rejected submissions do not', t => {
  const h = setup(t), requestId = randomUUID();
  h.repository.use(h.location, db => {
    const sent = db.append(0, requestId, 'First');
    const settled = db.settle(sent.revision, true);
    assert.equal(db.append(0, requestId, 'First').settledAt, settled.settledAt);
    assert.throws(() => db.append(settled.revision, randomUUID(), ' '), /must contain text/);
    assert.throws(() => db.append(0, randomUUID(), 'Stale'), /changed elsewhere/);
    assert.equal(db.read().settledAt, settled.settledAt);
    const started = db.turns.start(settled.revision, randomUUID(), 'Continue', settings);
    assert.equal(started.settledAt, null);
    assert.throws(() => db.settle(started.revision, true), /Stop the active response/);
    assert.equal(db.read().revision, started.revision);
  });
});

test('claimed and running Bash jobs block settlement; a late background continuation reactivates atomically', t => {
  const h = setup(t), turnId = randomUUID();
  h.repository.use(h.location, db => {
    db.turns.start(0, turnId, 'Run work', settings);
    db.turns.finish(turnId, 'completed', 'Started a job', null);
    const job = { id: randomUUID(), turnId, callId: 'call-1', command: 'true', background: true,
      status: 'claimed', exitCode: null, signal: null, text: '', truncated: false, outputClosed: false,
      message: null, createdAt: Date.now(), accountKey: 'account', pid: null, identity: null, notified: false };
    for (const status of ['claimed', 'running']) {
      db.jobs.save({ ...job, status });
      assert.throws(() => db.settle(db.read().revision, true), /Stop running Bash jobs/);
      assert.equal(db.read().settledAt, null);
    }
    db.jobs.save({ ...job, status: 'exited', outputClosed: true, exitCode: 0 });
    const settled = db.settle(db.read().revision, true);
    const resumed = db.turns.backgroundStart(randomUUID(), settings, 'account', []);
    assert.equal(resumed.settledAt, null);
    assert.equal(resumed.revision, settled.revision + 1);
    assert.throws(() => db.settle(resumed.revision, true), /Stop the active response/);
  });
});

test('version 3 databases migrate without changing content; settled sessions can still be deleted', t => {
  const h = setup(t);
  h.repository.use(h.location, db => db.draft(0, 'Legacy draft'));
  const raw = new DatabaseSync(h.file);
  raw.exec(`DROP TABLE file_operations; DROP TABLE compactions; DROP TABLE entry_images; DROP TABLE image_chunks;
    DROP TABLE image_uploads; DROP TABLE images;
    ALTER TABLE turns DROP COLUMN operation; ALTER TABLE turns DROP COLUMN phase; ALTER TABLE turns DROP COLUMN context;
    ALTER TABLE turns DROP COLUMN context_projection;
    ALTER TABLE session DROP COLUMN settled_at; PRAGMA user_version=3;`); raw.close();
  const loaded = h.repository.use(h.location, db => db.read());
  assert.equal(loaded.settledAt, null);
  assert.equal(loaded.draft, 'Legacy draft');
  const check = new DatabaseSync(h.file);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, 9);
  assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []); check.close();
  const settled = h.repository.use(h.location, db => db.settle(loaded.revision, true));
  h.repository.remove(h.location, settled.revision);
  assert.equal(h.repository.list().sessions.length, 0);
  assert.throws(() => h.repository.use(h.location, db => db.settle(settled.revision, false)));
});
