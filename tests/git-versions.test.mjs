import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitCommand } from '../dist/backend/git/command.js';
import { repositoryStatus } from '../dist/backend/git/status.js';
import { parseRawIndex } from '../dist/backend/git/versions.js';
import { WorkspaceChanges } from '../dist/backend/git/changes.js';
import { fileHarness } from './helpers/fileTools.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'flame-git-versions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const args of [['init', '--initial-branch=main'], ['config', 'user.name', 'Tests'], ['config', 'user.email', 'tests@example.invalid'], ['config', 'commit.gpgSign', 'false']]) await gitCommand(root, args);
  return root;
}
const versionOf = async (root, path) => (await repositoryStatus('p', root, undefined, true)).files.find(file => file.path === path);

test('raw index parsing maps staged paths to their blob ids and rejects malformed listings', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40), zero = '0'.repeat(40);
  assert.deepEqual([...parseRawIndex(`:100644 100644 ${a} ${b} M\0with space\nnewline\0:100644 000000 ${a} ${zero} D\0gone\0`)], [['with space\nnewline', b], ['gone', zero]]);
  assert.deepEqual([...parseRawIndex('')], []);
  for (const malformed of [`100644 100644 ${a} ${b} M\0x\0`, `:100644 ${a} ${b} M\0x\0`, `:100644 100644 ${a} xyz M\0x\0`, `:100644 100644 ${a} ${b} M\0`]) assert.throws(() => parseRawIndex(malformed));
});

test('file versions change on same-line-count edits, staging and atomic replacement, and stay stable otherwise', async t => {
  const root = await repository(t);
  await writeFile(join(root, 'app.ts'), 'one\ntwo\n'); await writeFile(join(root, 'other.ts'), 'x\n');
  await gitCommand(root, ['add', '.']); await gitCommand(root, ['commit', '-m', 'init']);
  await writeFile(join(root, 'app.ts'), 'one\nTWO\n'); await writeFile(join(root, 'other.ts'), 'y\n');
  const first = await versionOf(root, 'app.ts');
  assert.deepEqual(first.workingStats, { additions: 1, deletions: 1 });
  assert.match(first.version, /^[0-9a-f]{32}$/);
  assert.equal((await versionOf(root, 'app.ts')).version, first.version, 'an untouched file keeps its version');
  await writeFile(join(root, 'app.ts'), 'one\nthree\n');
  const edited = await versionOf(root, 'app.ts');
  assert.deepEqual(edited.workingStats, first.workingStats, 'line counts alone cannot see this edit');
  assert.notEqual(edited.version, first.version);
  const otherBefore = (await versionOf(root, 'other.ts')).version;
  await gitCommand(root, ['add', 'app.ts']);
  const staged = await versionOf(root, 'app.ts');
  assert.notEqual(staged.version, edited.version, 'staging changes the index side of the version');
  await writeFile(join(root, 'replacement'), 'one\nfour\n'); await rename(join(root, 'replacement'), join(root, 'app.ts'));
  assert.notEqual((await versionOf(root, 'app.ts')).version, staged.version, 'atomic rename-over writes are detected');
  assert.equal((await versionOf(root, 'other.ts')).version, otherBefore, 'unrelated files are unaffected');
  await writeFile(join(root, 'new.ts'), 'n\n');
  const untracked = await versionOf(root, 'new.ts');
  await rm(join(root, 'new.ts')); await writeFile(join(root, 'new.ts'), 'm\n');
  assert.notEqual((await versionOf(root, 'new.ts')).version, untracked.version, 'untracked files are versioned too');
  await rm(join(root, 'other.ts'));
  assert.match((await versionOf(root, 'other.ts')).version, /^[0-9a-f]{32}$/, 'deleted files still get a stable version');
  assert.equal((await repositoryStatus('p', root)).files.every(file => file.version === undefined), true, 'operation-time status skips versions');
});

test('workspace changes advance per project and notify listeners', () => {
  const changes = new WorkspaceChanges(), seen = [];
  changes.on('change', (projectId, revision) => seen.push([projectId, revision]));
  assert.equal(changes.revision('a'), 0);
  changes.touch('a'); changes.touch('a'); changes.touch('b');
  assert.deepEqual(seen, [['a', 1], ['a', 2], ['b', 1]]);
  assert.equal(changes.revision('a'), 2);
});

test('file tools announce every write/edit attempt but never reads or listings', async t => {
  const h = fileHarness(t), mutated = [];
  h.files.on('mutated', location => mutated.push(location.projectId));
  await h.execute('write', { path: 'a.txt', content: 'one\n', expected_sha256: null });
  assert.deepEqual(mutated, [h.location.projectId]);
  await h.execute('read', { path: 'a.txt', offset: null, limit: null });
  await h.execute('ls', { path: '.' });
  assert.equal(mutated.length, 1);
  await h.execute('edit', { path: 'a.txt', expected_sha256: '0'.repeat(64), edits: [{ oldText: 'one', newText: 'two' }] });
  assert.equal(mutated.length, 2, 'a rejected edit is still announced; the client recheck is cheap and harmless');
});
