import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, statSync, symlinkSync, linkSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileHarness, tool } from './helpers/fileTools.mjs';
import { replaceText } from '../dist/backend/file-tools/edit.js';
import { parseOperation } from '../dist/backend/file-tools/validation.js';
import { digest } from '../dist/backend/file-tools/filesystem.js';
import { withFileLock } from '../dist/backend/file-tools/mutation-queue.js';
import { FileTools } from '../dist/backend/file-tools/service.js';

const opts = { skip: process.platform === 'win32' };
test('bounded UTF-8 reads expose complete lines, raw hashes, EOF, and explicit input failures', opts, async t => {
  const h = fileHarness(t), original = '\uFEFFone\r\ntwø\r\nthree\r\n';
  writeFileSync(join(h.work, 'source'), original);
  const first = await h.execute('read', { path: 'source', offset: null, limit: 2 });
  assert.equal(first.content, 'one\ntwø'); assert.equal(first.next_offset, 3);
  assert.equal(first.sha256, createHash('sha256').update(original).digest('hex'));
  assert.equal((await h.execute('read', { path: 'source', offset: 3, limit: null })).next_offset, null);
  assert.match((await h.execute('read', { path: 'source', offset: 5, limit: null })).error, /beyond/);
  for (const offset of [0, -1, 1.5, '1']) assert.equal((await h.execute('read', { path: 'source', offset, limit: null })).status, 'failed');
  writeFileSync(join(h.work, 'empty'), '');
  assert.equal((await h.execute('read', { path: 'empty' })).total_lines, 0);
  writeFileSync(join(h.work, 'large-line'), 'a'.repeat(65537));
  assert.match((await h.execute('read', { path: 'large-line' })).error, /64 KiB/);
  writeFileSync(join(h.work, 'bytes'), Buffer.from([0xff, 0xfe]));
  assert.match((await h.execute('read', { path: 'bytes' })).error, /UTF-8/);
  writeFileSync(join(h.work, 'bytes'), 'a\0b');
  assert.match((await h.execute('read', { path: 'bytes' })).error, /binary/);
  assert.equal((await h.execute('read', { path: '.' })).status, 'failed');
});

test('edit matching is original-relative, unique, non-overlapping, and preserves BOM/CRLF', () => {
  assert.equal(replaceText('\uFEFFa\r\nb\r\nc\r\n', [{ oldText: 'a\nb', newText: 'b\na' }, { oldText: 'c', newText: 'd' }]), '\uFEFFb\r\na\r\nd\r\n');
  assert.equal(replaceText('a b', [{ oldText: 'a', newText: 'b' }, { oldText: 'b', newText: 'c' }]), 'b c');
  assert.throws(() => replaceText('aaa', [{ oldText: 'aa', newText: 'x' }]), /more than once/);
  assert.throws(() => replaceText('abcdef', [{ oldText: 'abcd', newText: 'x' }, { oldText: 'cde', newText: 'y' }]), /overlap/);
  assert.throws(() => replaceText('a\r\nb\n', [{ oldText: 'a', newText: 'x' }]), /mixed/);
  assert.throws(() => parseOperation('edit', JSON.stringify({ path: 'a', expected_sha256: null, edits: [{ oldText: '', newText: 'x' }] })), /not be empty/);
});

test('atomic writes require read hashes, preserve mode, and never replay a completed call', opts, async t => {
  const h = fileHarness(t), path = join(h.work, 'nested', 'file'), id = randomUUID();
  const args = { path: 'nested/file', content: 'one\n', expected_sha256: null };
  assert.equal((await h.execute('write', args, undefined, id)).status, 'completed');
  writeFileSync(path, 'external\n', { mode: 0o755 });
  assert.equal((await h.execute('write', args, undefined, id)).status, 'completed');
  assert.equal(readFileSync(path, 'utf8'), 'external\n');
  assert.equal((await h.execute('write', { ...args, content: 'two' })).status, 'failed');
  const read = await h.execute('read', { path: 'nested/file' }), mode = statSync(path).mode & 0o777;
  assert.equal((await h.execute('edit', { path: 'nested/file', expected_sha256: read.sha256, edits: [{ oldText: 'external', newText: 'edited' }] })).status, 'completed');
  assert.equal(readFileSync(path, 'utf8'), 'edited\n'); assert.equal(statSync(path).mode & 0o777, mode);
  assert.equal((await h.execute('write', { ...args, expected_sha256: read.sha256 })).status, 'failed');
  assert.deepEqual(readdirSync(join(h.work, 'nested')), ['file']);
});

test('all edit validation happens before replacing any bytes; symlinks are preserved and hardlinks rejected', opts, async t => {
  const h = fileHarness(t), target = join(h.work, 'target'); writeFileSync(target, 'a b c');
  symlinkSync('target', join(h.work, 'alias'));
  const bad = await h.execute('edit', { path: 'alias', expected_sha256: null, edits: [{ oldText: 'a', newText: 'x' }, { oldText: 'missing', newText: 'z' }] });
  assert.equal(bad.status, 'failed'); assert.equal(readFileSync(target, 'utf8'), 'a b c');
  assert.equal((await h.execute('edit', { path: 'alias', expected_sha256: null, edits: [{ oldText: 'a', newText: 'x' }] })).status, 'completed');
  assert.equal(readFileSync(target, 'utf8'), 'x b c'); assert.ok(lstatSync(join(h.work, 'alias')).isSymbolicLink());
  linkSync(target, join(h.work, 'hard'));
  assert.match((await h.execute('write', { path: 'target', expected_sha256: digest('x b c'), content: 'no' })).error, /hard-linked/);
  assert.equal(readFileSync(target, 'utf8'), 'x b c');
});

test('concurrent hash-guarded mutations serialize across aliases and cannot both overwrite the same version', opts, async t => {
  const h = fileHarness(t); writeFileSync(join(h.work, 'target'), 'original'); symlinkSync('target', join(h.work, 'alias'));
  const outcomes = await Promise.all(['target', 'alias'].map((path, i) => h.execute('write', { path, content: `new-${i}`, expected_sha256: digest('original') })));
  assert.deepEqual(outcomes.map(result => result.status).sort(), ['completed', 'failed']);
});

test('Stop while queued cannot mutate later, and the claim retains its failure outcome', opts, async t => {
  const h = fileHarness(t), controller = new AbortController(), path = join(h.work, 'target'); writeFileSync(path, 'before');
  let release;
  const blocking = withFileLock(path, new AbortController().signal, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const pending = h.execute('write', { path: 'target', content: 'after', expected_sha256: digest('before') }, controller.signal);
  controller.abort(); release(); await blocking;
  assert.equal((await pending).status, 'failed'); assert.equal(readFileSync(path, 'utf8'), 'before');
});

test('durable claims prevent replay after restart, and saved outcomes restore interrupted UI details', opts, async t => {
  const h = fileHarness(t), call = tool('write', { path: 'saved', content: 'once', expected_sha256: null });
  h.sessions.turns(h.location, store => store.progress(h.turnId, '', [call]));
  assert.equal((await h.files.execute(h.location, h.turnId, call, new AbortController().signal)).status, 'completed');
  const recovered = new FileTools(h.sessions, () => h.work);
  writeFileSync(join(h.work, 'saved'), 'changed externally');
  assert.equal((await recovered.execute(h.location, h.turnId, call, new AbortController().signal)).status, 'completed');
  assert.equal(readFileSync(join(h.work, 'saved'), 'utf8'), 'changed externally');
  const activity = h.sessions.turns(h.location, store => { store.recover(); return store.snapshot(); }).activity;
  assert.equal(activity.steps[0].file.status, 'completed');
  assert.ok(JSON.stringify(recovered.ledger(h.location)).includes('Created file'));
});

test('failed claim prevents a write; a failed outcome save retains uncertainty without replay', opts, async t => {
  const h = fileHarness(t), original = h.sessions.files.bind(h.sessions);
  function fail(method) {
    h.sessions.files = (location, work) => original(location, store => work(new Proxy(store, { get(target, property) {
      if (property === method) return () => { throw new Error('Disk unavailable'); };
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } })));
  }
  const call = tool('write', { path: 'target', content: 'once', expected_sha256: null });
  fail('claim'); await assert.rejects(h.files.execute(h.location, h.turnId, call, new AbortController().signal), /claim.*No new file/);
  assert.throws(() => readFileSync(join(h.work, 'target')), /ENOENT/);
  fail('finish'); await assert.rejects(h.files.execute(h.location, h.turnId, call, new AbortController().signal), /result could not be saved/);
  h.sessions.files = original;
  assert.equal((await h.files.execute(h.location, h.turnId, call, new AbortController().signal)).status, 'uncertain');
  assert.equal(readFileSync(join(h.work, 'target'), 'utf8'), 'once');
});
