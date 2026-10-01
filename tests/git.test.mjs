import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, link, mkdtemp, writeFile, readFile, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { GitStore } from '../dist/backend/git/store.js';
import { openGitRuntime } from '../dist/backend/git/runtime.js';
import { gitCommand, safeGitMessage } from '../dist/backend/git/command.js';
import { parseStatus } from '../dist/backend/git/status.js';
import { gitFixture } from './helpers/gitFixture.mjs';

test('Git status parsing preserves whitespace, newline paths, and rename records', () => {
  assert.deepEqual(parseStatus(' M white space.ts\0R  renamed\0original\0?? new\nline\0'), [{ path: 'white space.ts', originalPath: null, index: ' ', worktree: 'M' }, { path: 'renamed', originalPath: 'original', index: 'R', worktree: ' ' }, { path: 'new\nline', originalPath: null, index: '?', worktree: '?' }]);
  assert.throws(() => parseStatus('R  bad\0')); assert.throws(() => parseStatus('garbage\0'));
  assert.equal(safeGitMessage('https://secret@host?access_token=token'), 'https://[redacted]@host?access_token=[redacted]');
  assert.equal(safeGitMessage(`token ghp_${'a'.repeat(36)} leaked`), 'token [redacted] leaked');
});
test('initialization, selected-file commits, all-change commits and duplicate submissions are durable and idempotent', async t => {
  const f = await gitFixture(t); assert.equal((await f.service.status(f.projectId)).repository, false);
  const initialize = f.input('init', { message: '' }); const accepted = await Promise.all([f.service.start(initialize), f.service.start(initialize)]);
  assert.equal(accepted[0].requestId, accepted[1].requestId);
  const initialized = await f.terminal(initialize.requestId); assert.equal(initialized.state, 'completed'); assert.equal(initialized.result.toast.title, 'Initialized repository');
  await f.configure();
  assert.equal((await f.run('commit')).state, 'failed', 'a clean worktree has nothing to commit');
  await writeFile(join(f.cwd, 'a.ts'), 'const a = 1;\n'); await writeFile(join(f.cwd, 'b.ts'), 'const b = 2;\n');
  await gitCommand(f.cwd, ['add', '--', 'b.ts']);
  const request = f.input('commit', { filePaths: ['a.ts'] }); await f.service.start(request); const operation = await f.terminal(request.requestId);
  assert.equal(operation.state, 'completed'); assert.ok(operation.commit); assert.equal(operation.result.commit.subject, 'Add initial source');
  assert.match(operation.result.toast.title, /^Committed [0-9a-f]{7}$/); assert.deepEqual(operation.result.toast.cta, { kind: 'none' }, 'no remote, so nothing to push to');
  const left = (await f.service.status(f.projectId)).files; assert.deepEqual(left.map(file => [file.path, file.index]), [['b.ts', '?']], 'unselected files stay uncommitted, even ones staged before');
  assert.equal((await f.service.start(request)).commit, operation.commit); await delay(30);
  assert.equal(await f.count(), 1);
  await assert.rejects(f.service.start({ ...request, message: 'Different' }), { code: 'INVALID' });
  await assert.rejects(f.service.start({ ...request, filePaths: ['b.ts'] }), { code: 'INVALID' }, 'file selections are part of the request identity');
  assert.equal((await f.run('commit', { message: 'Add remaining source\n\nWith a body line.' })).state, 'completed'); assert.equal((await f.service.status(f.projectId)).files.length, 0);
  assert.equal((await gitCommand(f.cwd, ['log', '-1', '--format=%B'])).stdout.toString().trim(), 'Add remaining source\n\nWith a body line.');
});
test('commit and push, plain push, and push failure expose the actual commit outcome', async t => {
  const f = await gitFixture(t); await f.init(); const remote = await f.remote(); await writeFile(join(f.cwd, 'source.txt'), 'one\n');
  const first = await f.run('commit_push', { expectedBranch: 'main' }); assert.equal(first.state, 'completed'); assert.ok(first.commit);
  assert.equal(first.result.push.upstream, 'origin/main'); assert.equal(first.result.push.setUpstream, true); assert.match(first.result.toast.title, /^Pushed [0-9a-f]{7} to origin\/main$/);
  assert.equal((await f.service.status(f.projectId)).upstream, 'origin/main');
  await gitCommand(f.cwd, ['tag', '-a', 'private-tag', '-m', 'Do not push tags']);
  await gitCommand(f.cwd, ['config', 'push.followTags', 'true']); await gitCommand(f.cwd, ['config', 'remote.origin.mirror', 'true']);
  await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'Local only']);
  const ahead = await f.service.status(f.projectId); assert.equal(ahead.ahead, 1); assert.equal(ahead.behind, 0);
  const pushed = await f.run('push', { message: '', expectedBranch: 'main' }); assert.equal(pushed.state, 'completed'); assert.equal(pushed.result.push.skipped, false);
  assert.equal((await gitCommand(f.cwd, ['ls-remote', '--tags', remote])).stdout.length, 0, 'push ignores configured mirroring and follow-tags');
  const again = await f.run('push', { message: '', expectedBranch: 'main' }); assert.equal(again.result.push.skipped, true); assert.equal(again.result.toast.title, 'Already up to date');
  await writeFile(join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\necho rejected-for-test >&2\nexit 1\n', { mode: 0o755 });
  await writeFile(join(f.cwd, 'source.txt'), 'two\n');
  const failed = await f.run('commit_push', { message: 'Update source', expectedBranch: 'main' }); assert.equal(failed.state, 'failed'); assert.ok(failed.commit); assert.match(failed.detail, /was created/); assert.match(failed.detail, /rejected/);
  assert.equal(await f.count(), 3);
  const moved = await f.run('push', { message: '', expectedBranch: 'elsewhere' }); assert.equal(moved.state, 'failed'); assert.match(moved.detail, /branch changed/);
});
test('file views distinguish staged and working content, renamed files, deletions, binary, symlinks and limits', async t => {
  const f = await gitFixture(t); await f.init(); await writeFile(join(f.cwd, 'old.ts'), 'const n = 1;\n'); await f.run('commit');
  await gitCommand(f.cwd, ['mv', 'old.ts', 'renamed.ts']); await writeFile(join(f.cwd, 'renamed.ts'), 'const n = 2;\n');
  const staged = await f.service.file({ projectId: f.projectId, path: 'renamed.ts', mode: 'staged' }); assert.equal(staged.beforePath, 'old.ts'); assert.equal(staged.before, 'const n = 1;\n'); assert.equal(staged.after, 'const n = 1;\n');
  const working = await f.service.file({ projectId: f.projectId, path: 'renamed.ts', mode: 'working' }); assert.equal(working.beforePath, 'renamed.ts'); assert.equal(working.before, 'const n = 1;\n'); assert.equal(working.after, 'const n = 2;\n');
  await writeFile(join(f.cwd, '1:colon.ts'), 'const colon = 1;\n'); await gitCommand(f.cwd, ['add', '--', '1:colon.ts']);
  assert.equal((await f.service.file({ projectId: f.projectId, path: '1:colon.ts', mode: 'staged' })).after, 'const colon = 1;\n');
  await writeFile(join(f.cwd, 'binary'), Buffer.from([0, 1, 255])); assert.equal((await f.service.file({ projectId: f.projectId, path: 'binary', mode: 'working' })).binary, true);
  await symlink('/etc/passwd', join(f.cwd, 'link')); const link = await f.service.file({ projectId: f.projectId, path: 'link', mode: 'working' }); assert.equal(link.after, '/etc/passwd');
  await writeFile(join(f.cwd, 'large.txt'), 'x'.repeat(4 * 1024 * 1024 + 1)); await assert.rejects(f.service.file({ projectId: f.projectId, path: 'large.txt', mode: 'working' }), { code: 'INVALID' });
  await assert.rejects(f.service.file({ projectId: f.projectId, path: '../escape', mode: 'working' }), { code: 'NOT_FOUND' });
  await writeFile(join(f.cwd, 'bom.txt'), '﻿one\r\ntwo\r\n'); assert.equal((await f.service.file({ projectId: f.projectId, path: 'bom.txt', mode: 'working' })).after, '﻿one\r\ntwo\r\n');
  await rm(join(f.cwd, 'renamed.ts')); const deleted = await f.service.file({ projectId: f.projectId, path: 'renamed.ts', mode: 'working' }); assert.equal(deleted.after, ''); assert.equal(deleted.before, 'const n = 1;\n');
});
test('running actions reject duplicates, report hook progress, and shutdown never replays a claim', async t => {
  const f = await gitFixture(t); await f.init(); await writeFile(join(f.cwd, 'a'), 'a');
  await writeFile(join(f.cwd, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho checking formatting\nprintf started > hook-started\nsleep 30\n', { mode: 0o755 });
  const request = f.input('commit'); await f.service.start(request);
  for (let i = 0; i < 300; i++) { try { await readFile(join(f.cwd, 'hook-started')); break; } catch { await delay(10); } }
  let hook = null;
  for (let i = 0; i < 300 && !hook?.output; i++) { hook = f.store.get(request.requestId).hook; await delay(10); }
  assert.equal(hook?.name, 'pre-commit', 'the running hook is reported'); assert.equal(hook?.output, 'checking formatting', 'with its latest output line');
  assert.equal(f.store.get(request.requestId).phase, 'Committing...');
  await assert.rejects(f.service.start(f.input('commit')), { code: 'BUSY' });
  await f.service.close(); const stopped = f.store.get(request.requestId); assert.equal(stopped.state, 'interrupted'); assert.equal(stopped.hook, null);
  assert.equal((await gitCommand(f.cwd, ['rev-list', '--count', 'HEAD'], { allowed: [0, 128] })).code, 128);
});
test('durable recovery marks in-flight claims uncertain and request validation rejects unsafe input', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flame-git-recovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const filename = join(root, 'git.sqlite'), input = { projectId: randomUUID(), requestId: randomUUID(), action: 'push', message: '', filePaths: null, featureBranch: false, expectedBranch: 'main', model: null, publish: null };
  const store = new GitStore(filename); store.claim(input); store.close(); const recovered = new GitStore(filename);
  try { assert.equal(recovered.get(input.requestId).state, 'interrupted'); assert.match(recovered.get(input.requestId).detail, /not been replayed/); assert.equal(recovered.claim(input).state, 'interrupted'); } finally { recovered.close(); }
  const f = await gitFixture(t); await f.init();
  await assert.rejects(f.service.start(f.input('push', { message: 'stray' })), { code: 'INVALID' }, 'messages only apply to commits');
  await assert.rejects(f.service.start(f.input('push', { message: '', filePaths: ['a'] })), { code: 'INVALID' });
  await assert.rejects(f.service.start(f.input('commit', { filePaths: ['/etc/passwd'] })), { code: 'INVALID' });
  await assert.rejects(f.service.start(f.input('pull', { message: '', featureBranch: true })), { code: 'INVALID' });
  await assert.rejects(f.service.start(f.input('publish', { message: '' })), { code: 'INVALID' }, 'publishing needs a target');
  await assert.rejects(f.service.start(f.input('commit', { publish: { provider: 'github', repository: 'a/b', visibility: 'private', remote: 'origin', protocol: 'ssh' } })), { code: 'INVALID' });
  await assert.rejects(f.service.start({ ...f.input('commit'), action: 'rebase' }), { code: 'INVALID' });
});
test('private Git databases reject unsafe files and future versions without blocking the optional runtime', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flame-git-private-')); t.after(() => rm(root, { recursive: true, force: true }));
  const filename = join(root, 'git.sqlite'), initial = new GitStore(filename); initial.close();
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const db = new DatabaseSync(filename); db.exec('PRAGMA user_version=999'); db.close();
  assert.throws(() => new GitStore(filename), { code: 'STORAGE' });
  const verify = new DatabaseSync(filename); assert.equal(verify.prepare('PRAGMA user_version').get().user_version, 999); verify.close();
  const unavailable = openGitRuntime(filename, () => root);
  await assert.rejects(unavailable.status(randomUUID()), { code: 'STORAGE' }); await assert.rejects(unavailable.hosting(), { code: 'STORAGE' }); await unavailable.close();
  const alias = join(root, 'alias.sqlite'); await symlink(filename, alias); assert.throws(() => new GitStore(alias), { code: 'STORAGE' });
  const hard = join(root, 'hard.sqlite'); await link(filename, hard); assert.throws(() => new GitStore(hard), { code: 'STORAGE' }); await rm(hard);
  await chmod(filename, 0o644); assert.throws(() => new GitStore(filename), { code: 'STORAGE' });
});
test('version 1 operation history is converted in place without losing receipts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flame-git-migrate-')); t.after(() => rm(root, { recursive: true, force: true }));
  const filename = join(root, 'git.sqlite'); new GitStore(filename).close();
  const db = new DatabaseSync(filename), projectId = randomUUID(), requestId = randomUUID(), running = randomUUID();
  db.exec('DELETE FROM git_operations; PRAGMA user_version=1');
  const legacy = { projectId, requestId, action: 'commit_push', scope: 'all', message: 'Old commit', remote: 'origin', branch: 'main', setUpstream: true, state: 'completed', phase: 'Completed', detail: 'Git action completed.', commit: 'a'.repeat(40), createdAt: 1, updatedAt: 2 };
  db.prepare('INSERT INTO git_operations VALUES (?, ?, ?)').run(requestId, projectId, JSON.stringify(legacy));
  db.prepare('INSERT INTO git_operations VALUES (?, ?, ?)').run(running, projectId, JSON.stringify({ ...legacy, requestId: running, state: 'running' }));
  db.close();
  const store = new GitStore(filename);
  try {
    const converted = store.get(requestId);
    assert.equal(converted.state, 'completed'); assert.equal(converted.commit, 'a'.repeat(40)); assert.equal(converted.expectedBranch, 'main'); assert.equal(converted.filePaths, null); assert.deepEqual(converted.phases, []);
    assert.equal(store.get(running).state, 'interrupted');
  } finally { store.close(); }
  const verify = new DatabaseSync(filename); assert.equal(verify.prepare('PRAGMA user_version').get().user_version, 2); verify.close();
});
test('view requests have a bounded concurrency lane independent of mutation claims', async t => {
  const f = await gitFixture(t);
  const reads = Array.from({ length: 4 }, () => f.service.status(f.projectId));
  await assert.rejects(f.service.status(f.projectId), { code: 'BUSY' }); await Promise.all(reads);
  assert.equal((await f.service.status(f.projectId)).repository, false);
});
test('progress-write failure exposes the known commit, blocks further mutations and never replays the durable claim', async t => {
  const f = await gitFixture(t); await f.init(); await writeFile(join(f.cwd, 'source'), 'one');
  const update = f.store.update.bind(f.store);
  f.store.update = operation => { if (operation.commit) throw new Error('simulated disk full'); update(operation); };
  const input = f.input('commit'); await f.service.start(input);
  let latest;
  for (let i = 0; i < 300; i++) { latest = f.service.list(f.projectId)[0]; if (latest.state !== 'running') break; await delay(10); }
  assert.equal(latest.state, 'interrupted'); assert.ok(latest.commit); assert.match(latest.detail, /could not be saved/);
  assert.equal(f.store.get(input.requestId).state, 'running', 'the original durable claim survives');
  assert.equal((await f.service.start(input)).state, 'interrupted', 'same-ID retry returns the uncertain result without another mutation');
  await assert.rejects(f.service.start(f.input('commit')), { code: 'STORAGE' });
  assert.equal(await f.count(), 1);
  assert.equal((await f.service.status(f.projectId)).repository, true, 'read-only inspection still works');
});
test('opening files is confined to the project and reports missing files', async t => {
  const opened = [];
  const f = await gitFixture(t, { openPath: async path => { opened.push(path); } });
  await writeFile(join(f.cwd, 'note.md'), 'hi');
  await f.service.open(f.projectId, 'note.md'); assert.deepEqual(opened, [join(await (await import('node:fs/promises')).realpath(f.cwd), 'note.md')]);
  await assert.rejects(f.service.open(f.projectId, '../outside'), { code: 'NOT_FOUND' });
  await symlink('/etc/passwd', join(f.cwd, 'escape')); await assert.rejects(f.service.open(f.projectId, 'escape'), { code: 'INVALID' });
  await assert.rejects(f.service.open(f.projectId, 'missing.md'), { code: 'NOT_FOUND' });
});
