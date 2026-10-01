import assert from 'node:assert/strict';
import test from 'node:test';
import { createGitStatusStore } from '../src/renderer/components/workspace/git/gitStatusStore.ts';
import { sameGitStatus } from '../src/renderer/components/workspace/git/gitStatusEqual.ts';

const status = (files = [], extra = {}) => ({ projectId: 'p', repository: true, root: '/repo', branch: 'main', upstream: null, remotes: ['origin'], files, ...extra });
const file = (path, workingStats = { additions: 1, deletions: 0 }) => ({ path, originalPath: null, index: ' ', worktree: 'M', workingStats });
function source(results) {
  const calls = [];
  return { calls, read(projectId) { calls.push(projectId); const next = results.shift(); return next instanceof Error ? Promise.reject(next) : Promise.resolve(next); }, describe: error => `failed: ${error.message}` };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferredSource() {
  const pending = [];
  return { pending, read() { return new Promise((resolve, reject) => pending.push({ resolve, reject })); }, describe: error => error.message };
}

test('status equality covers every field the UI renders, including line statistics', () => {
  assert.equal(sameGitStatus(status([file('a.ts')]), status([file('a.ts')])), true);
  assert.equal(sameGitStatus(status([file('a.ts')]), status([file('a.ts', { additions: 2, deletions: 0 })])), false);
  assert.equal(sameGitStatus(status([file('a.ts')]), status([file('b.ts')])), false);
  assert.equal(sameGitStatus(status([]), status([], { branch: 'dev' })), false);
  assert.equal(sameGitStatus(status([]), status([], { remotes: ['upstream'] })), false);
  const { workingStats: _omitted, ...unknownStats } = file('a.ts');
  assert.equal(sameGitStatus(status([file('a.ts', null)]), status([unknownStats])), true, 'missing and null statistics both mean unknown');
  assert.equal(sameGitStatus(null, status()), false);
});

test('an unchanged check keeps the cached object and never notifies subscribers', async () => {
  const store = createGitStatusStore(), first = status([file('a.ts')]);
  const reads = source([first, status([file('a.ts')])]);
  await store.refresh('p', reads, 'check');
  const cached = store.snapshot('p').status;
  assert.equal(cached, first);
  let notified = 0; store.subscribe('p', () => notified++);
  await store.refresh('p', reads, 'check');
  assert.equal(store.snapshot('p').status, cached);
  assert.equal(notified, 0, 'a quiet check with no changes must not re-render the panel');
});

test('a changed check replaces the status without ever showing a pending state', async () => {
  const store = createGitStatusStore(), reads = source([status([file('a.ts')]), status([file('a.ts'), file('b.ts')])]);
  await store.refresh('p', reads, 'check');
  const seen = []; store.subscribe('p', () => seen.push(store.snapshot('p').pending));
  await store.refresh('p', reads, 'check');
  assert.equal(store.snapshot('p').status.files.length, 2);
  assert.deepEqual(seen, [false]);
});

test('the first read and explicit reloads are visible as pending', async () => {
  const store = createGitStatusStore(), reads = deferredSource();
  const first = store.refresh('p', reads, 'check');
  assert.equal(store.snapshot('p').pending, true, 'nothing cached yet');
  await tick(); reads.pending.shift().resolve(status()); await first;
  assert.equal(store.snapshot('p').pending, false);
  const reload = store.refresh('p', reads, 'reload');
  assert.equal(store.snapshot('p').pending, true);
  await tick(); reads.pending.shift().resolve(status()); await reload;
  assert.equal(store.snapshot('p').pending, false);
});

test('checks share an in-flight read; a reload during a read queues exactly one fresh read', async () => {
  const store = createGitStatusStore(), reads = deferredSource();
  const a = store.refresh('p', reads, 'check'); await tick();
  const b = store.refresh('p', reads, 'check');
  assert.equal(reads.pending.length, 1, 'concurrent checks join the same read');
  const c = store.refresh('p', reads, 'reload'), d = store.refresh('p', reads, 'reload');
  assert.equal(c, d, 'reloads coalesce into one follow-up');
  reads.pending.shift().resolve(status([file('old.ts')])); await Promise.all([a, b]);
  await tick();
  assert.equal(reads.pending.length, 1, 'the reload starts after the stale read finished');
  assert.equal(store.snapshot('p').pending, true);
  reads.pending.shift().resolve(status([file('new.ts')])); await c;
  assert.equal(store.snapshot('p').status.files[0].path, 'new.ts');
  assert.equal(store.snapshot('p').pending, false);
});

test('failures keep the last known status and report a message; projects are isolated', async () => {
  const store = createGitStatusStore(), reads = source([status([file('a.ts')]), new Error('boom')]);
  await store.refresh('p', reads, 'check');
  await store.refresh('p', reads, 'reload');
  assert.equal(store.snapshot('p').status.files[0].path, 'a.ts');
  assert.equal(store.snapshot('p').error, 'failed: boom');
  assert.equal(store.snapshot('p').pending, false);
  assert.deepEqual(store.snapshot('other'), { status: null, pending: false, error: null });
  const recovered = source([status([file('a.ts')])]);
  await store.refresh('p', recovered, 'check');
  assert.equal(store.snapshot('p').error, null);
});

test('sync stays quiet but always reads after the call, so agent edits during a read are not missed', async () => {
  const store = createGitStatusStore(), reads = deferredSource();
  const first = store.refresh('p', reads, 'check'); await tick();
  reads.pending.shift().resolve(status([file('a.ts')])); await first;
  const stale = store.refresh('p', reads, 'check'); await tick();
  const seen = []; store.subscribe('p', () => seen.push(store.snapshot('p').pending));
  const synced = store.refresh('p', reads, 'sync');
  assert.equal(store.snapshot('p').pending, false, 'sync never shows a loading state');
  reads.pending.shift().resolve(status([file('a.ts')])); await stale; await tick();
  assert.equal(reads.pending.length, 1, 'a fresh read was queued behind the in-flight one');
  reads.pending.shift().resolve(status([file('a.ts', { additions: 9, deletions: 0 })])); await synced;
  assert.equal(store.snapshot('p').status.files[0].workingStats.additions, 9);
  assert.equal(seen.includes(true), false);
});

test('a version change alone is a real change', () => {
  assert.equal(sameGitStatus(status([{ ...file('a.ts'), version: 'v1' }]), status([{ ...file('a.ts'), version: 'v2' }])), false);
  assert.equal(sameGitStatus(status([{ ...file('a.ts'), version: 'v1' }]), status([{ ...file('a.ts'), version: 'v1' }])), true);
});
