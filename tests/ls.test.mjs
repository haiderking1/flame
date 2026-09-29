import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { fileHarness, tool } from './helpers/fileTools.mjs';
import { parseOperation } from '../dist/backend/file-tools/validation.js';
import { FileTools } from '../dist/backend/file-tools/service.js';
import { MAX_LS_BYTES } from '../dist/backend/file-tools/types.js';

const opts = { skip: process.platform === 'win32' };
test('ls defaults to the project, includes dotfiles, sorts names, and never recurses', opts, async t => {
  const h = fileHarness(t);
  mkdirSync(join(h.work, 'Folder')); writeFileSync(join(h.work, 'Folder', 'must-not-appear'), 'nested');
  writeFileSync(join(h.work, '.hidden'), 'hidden'); writeFileSync(join(h.work, 'zebra'), 'z'); writeFileSync(join(h.work, 'Apple'), 'a');
  const result = await h.execute('ls', { path: null, limit: null });
  assert.equal(result.status, 'completed'); assert.equal(result.content, '.hidden\nApple\nFolder/\nzebra');
  assert.equal(result.entries, 4); assert.equal(result.truncated, false);
  assert.equal((await h.execute('ls', { path: h.work })).content, result.content);
  assert.equal((await h.execute('ls', { path: 'Folder' })).content, 'must-not-appear');
  assert.deepEqual(h.files.ledger(h.location), [], 'read-only listings must not inflate the mutation ledger');
});

test('ls marks symlinked directories without descending into them and reports inaccessible entries', opts, async t => {
  const h = fileHarness(t); mkdirSync(join(h.root, 'outside')); writeFileSync(join(h.root, 'outside', 'unrelated'), 'x');
  symlinkSync(join(h.root, 'outside'), join(h.work, 'alias'));
  symlinkSync('missing', join(h.work, 'broken'));
  const result = await h.execute('ls', {});
  assert.equal(result.content, 'alias/'); assert.equal(result.entries, 1); assert.match(result.summary, /1 unavailable entry/);
  assert.ok(!result.content.includes('unrelated'));
});

test('ls uses 500 entries by default, supports a smaller/larger limit, and reports truncation', opts, async t => {
  const h = fileHarness(t);
  for (let i = 0; i < 501; i++) writeFileSync(join(h.work, `file-${String(i).padStart(3, '0')}`), '');
  const result = await h.execute('ls', {});
  assert.equal(result.entries, 500); assert.equal(result.truncated, true); assert.match(result.summary, /500 entries limit/);
  assert.equal(result.content.split('\n').at(-1), 'file-499');
  assert.equal((await h.execute('ls', { limit: 2 })).content, 'file-000\nfile-001');
  const complete = await h.execute('ls', { limit: 1000 });
  assert.equal(complete.entries, 501); assert.equal(complete.truncated, false);
});

test('ls bounds UTF-8 output to 50 KiB without cutting names or characters', opts, async t => {
  const h = fileHarness(t);
  for (let i = 0; i < 300; i++) writeFileSync(join(h.work, `${String(i).padStart(3, '0')}-${'é'.repeat(110)}`), '');
  const result = await h.execute('ls', { limit: 1000 });
  assert.equal(result.truncated, true); assert.ok(result.entries > 0 && result.entries < 300);
  assert.ok(Buffer.byteLength(result.content) <= MAX_LS_BYTES); assert.match(result.summary, /50 KiB/);
  for (const line of result.content.split('\n')) assert.match(line, /^\d{3}-é{110}$/);
});

test('ls escapes control characters, distinguishes an empty directory, and rejects bad arguments/targets', opts, async t => {
  const h = fileHarness(t);
  assert.equal((await h.execute('ls', {})).content, '(empty directory)');
  writeFileSync(join(h.work, 'line\nbreak'), '');
  assert.equal((await h.execute('ls', {})).content, '"line\\nbreak"');
  for (const limit of [0, -1, 1.2, '5', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseOperation('ls', JSON.stringify({ limit })), /positive integer/);
  }
  assert.throws(() => parseOperation('ls', '{"recursive":true}'), /Unexpected tool argument/);
  assert.throws(() => parseOperation('ls', '{"path":"a\\u0000b"}'), /NUL/);
  assert.throws(() => parseOperation('ls', '{"path":false}'), /Unicode/);
  assert.match((await h.execute('ls', { path: 'line\nbreak' })).error, /not a directory/);
  assert.equal((await h.execute('ls', { path: 'missing' })).status, 'failed');
});

test('ls reports directory access failure rather than an empty listing', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const h = fileHarness(t), directory = join(h.work, 'private'); mkdirSync(directory); chmodSync(directory, 0);
  try { assert.match((await h.execute('ls', { path: 'private' })).error, /Permission denied/); }
  finally { chmodSync(directory, 0o700); }
});

test('saved listings survive recovery and repeated call IDs return the saved snapshot, not a new enumeration', opts, async t => {
  const h = fileHarness(t), id = randomUUID(), call = tool('ls', { path: null, limit: null }, id);
  writeFileSync(join(h.work, 'first'), '');
  h.sessions.turns(h.location, store => store.progress(h.turnId, '', [call]));
  assert.equal((await h.files.execute(h.location, h.turnId, call, new AbortController().signal)).content, 'first');
  writeFileSync(join(h.work, 'second'), '');
  const restored = new FileTools(h.sessions, () => h.work);
  assert.equal((await restored.execute(h.location, h.turnId, call, new AbortController().signal)).content, 'first');
  assert.match((await h.execute('ls', { limit: 2 }, undefined, id)).error, /reused with different arguments/);
  const snapshot = h.sessions.turns(h.location, store => { store.recover(); return store.snapshot(); });
  assert.equal(snapshot.activity.steps[0].command, 'List .');
  assert.equal(snapshot.activity.steps[0].file.output, 'first'); assert.equal(snapshot.activity.steps[0].file.status, 'completed');
});

test('Stop after a listing claim saves a read-only failure and never reports a completed listing', opts, async t => {
  const h = fileHarness(t), controller = new AbortController(), original = h.sessions.files.bind(h.sessions);
  h.sessions.files = (location, work) => original(location, store => work(new Proxy(store, { get(target, property) {
    if (property === 'claim') return (...args) => { const result = target.claim(...args); controller.abort(); return result; };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  const result = await h.execute('ls', {}, controller.signal);
  assert.equal(result.status, 'failed'); assert.match(result.error, /Read-only operation stopped/);
  h.sessions.files = original;
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(h.execute('ls', {}, stopped.signal));
});
