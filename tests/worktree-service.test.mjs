import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitCommand } from '../dist/backend/git/command.js';
import { WorktreeCleanup } from '../dist/backend/worktrees/cleanup.js';
import { DEFAULT_WORKTREE_SETTINGS } from '../dist/contracts/worktrees.js';
import { worktreeFixture, until, git } from './helpers/worktreeFixture.mjs';
import { fakeGitHub } from './helpers/fakeHosting.mjs';

const opts = { timeout: 30000, skip: process.platform === 'win32' };
const inherit = projectId => ({ projectId, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null, setupScript: null });
async function sessionWithWorktree(h) {
  const location = h.create();
  await h.newWorktree(location);
  await h.send(location); await h.settle(location);
  await until(() => !/^flame\/[0-9a-f]{8}$/.test(h.workspace(location).branch ?? ''), 'the branch to be named');
  return { location, path: h.workspace(location).worktreePath, branch: h.workspace(location).branch };
}
const remove = (h, location) => h.sessions.remove(location, h.sessions.read(location).revision);

test('a new worktree can be chosen only before the first message; an existing one can be shared', opts, async t => {
  const h = await worktreeFixture(t);
  const local = h.create();
  await h.send(local); await h.settle(local);
  await assert.rejects(h.newWorktree(local), { message: 'A new worktree can only be chosen before the first message. Pick a branch that already has a worktree instead.' });
  const { location, path, branch } = await sessionWithWorktree(h);
  const document = await h.configure(local, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: path });
  assert.deepEqual(document.workspace, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch, worktreePath: path }, 'the worktree\'s branch is adopted');
  assert.equal(h.roots.session(local), path);
  remove(h, location);
  assert.deepEqual(h.store.kept(), [], 'a worktree another session uses is not tracked as left over');
  await assert.rejects(h.worktrees.remove(h.projectId, path), { message: 'Another session still works in this worktree.' });
  remove(h, local);
  assert.deepEqual(h.store.kept().map(item => [item.path, item.branch]), [[path, branch]]);
  await h.worktrees.remove(h.projectId, path);
  assert.equal(existsSync(path), false);
  assert.deepEqual(h.store.kept(), []);
  assert.equal(await git(h.project, ['branch', '--list', branch]), branch, 'the branch and its commits are kept');
  await assert.rejects(h.worktrees.remove(h.projectId, h.root), { code: 'NOT_FOUND' });
});

test('switching branches records the branch on the session and refuses while a response runs there', opts, async t => {
  const h = await worktreeFixture(t);
  const location = h.create();
  assert.deepEqual(await h.worktrees.switchRef(location, 'feature/local', true), { branch: 'feature/local' });
  assert.equal(h.workspace(location).branch, 'feature/local');
  assert.equal(await git(h.project, ['branch', '--show-current']), 'feature/local');
  assert.ok(h.changed.includes(h.project));
});

test('worktree settings are saved, announced, and refused for unknown projects', opts, async t => {
  const h = await worktreeFixture(t);
  let announced = 0; h.worktrees.on('settings', () => announced++);
  const defaults = { ...DEFAULT_WORKTREE_SETTINGS, defaultMode: 'worktree', submodules: 'none' };
  assert.deepEqual(h.worktrees.saveDefaults(defaults).defaults, defaults);
  const project = { ...inherit(h.projectId), setupScript: { name: 'Install', command: 'bun install', wait: false } };
  assert.deepEqual(h.worktrees.saveProject(project).projects, [project]);
  assert.equal(announced, 2);
  assert.throws(() => h.worktrees.saveProject(inherit('22222222-2222-4222-8222-222222222222')), { code: 'NOT_FOUND' });
});

test('cleanup removes the worktree of a deleted session when asked, but never one with changes or ignored files', opts, async t => {
  const h = await worktreeFixture(t);
  h.worktrees.saveDefaults({ ...DEFAULT_WORKTREE_SETTINGS, cleanup: { afterDays: null, onMerge: false, onDelete: true, unchanged: false } });
  const kept = await sessionWithWorktree(h), dirty = await sessionWithWorktree(h), secret = await sessionWithWorktree(h), clean = await sessionWithWorktree(h);
  writeFileSync(join(dirty.path, 'notes.txt'), 'uncommitted\n');
  writeFileSync(join(secret.path, '.env'), 'TOKEN=1\n');
  mkdirSync(join(clean.path, 'node_modules')); writeFileSync(join(clean.path, 'node_modules', 'x.js'), '');
  for (const session of [dirty, secret, clean]) remove(h, session.location);
  // Git deletes the folder before it exits, and the record is forgotten only after that.
  await until(() => !existsSync(clean.path) && !h.store.kept().some(item => item.path === clean.path), 'the clean worktree to be removed and forgotten');
  assert.ok(existsSync(kept.path), 'a live session keeps its worktree');
  assert.ok(existsSync(dirty.path), 'uncommitted work is never removed');
  assert.ok(existsSync(secret.path), 'ignored files such as .env are never removed');
  assert.deepEqual(h.store.kept().map(item => item.path).sort(), [dirty.path, secret.path].sort());
});

test('cleanup removes inactive and unchanged worktrees but keeps the session ready to recreate them', opts, async t => {
  const h = await worktreeFixture(t);
  const bare = join(h.root, 'remote.git'); mkdirSync(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
  await gitCommand(h.project, ['remote', 'add', 'origin', bare]); await gitCommand(h.project, ['push', '-u', 'origin', 'main']); await gitCommand(h.project, ['remote', 'set-head', 'origin', 'main']);
  const unchanged = await sessionWithWorktree(h), changed = await sessionWithWorktree(h);
  writeFileSync(join(changed.path, 'work.txt'), 'work\n'); await gitCommand(changed.path, ['add', '.']); await gitCommand(changed.path, ['commit', '-m', 'Work']);
  let settings = { defaults: { ...DEFAULT_WORKTREE_SETTINGS, cleanup: { afterDays: null, onMerge: false, onDelete: false, unchanged: true } }, projects: [] };
  const busy = new Set();
  const cleanup = new WorktreeCleanup({ sessions: h.sessions, projects: h.projects, store: h.store, settings: () => settings, directory: join(h.root, 'worktrees'),
    busy: path => busy.has(path), changed: () => {}, now: () => Date.now() + 40 * 86_400_000 });
  t.after(() => cleanup.close());
  cleanup.schedule(); await cleanup.idle();
  assert.equal(existsSync(unchanged.path), false, 'no commits beyond the default branch');
  assert.ok(existsSync(changed.path), 'unpushed commits are kept');
  assert.deepEqual(h.workspace(unchanged.location).worktreePath, unchanged.path, 'the session still records its worktree');
  busy.add(changed.path);
  settings = { defaults: { ...settings.defaults, cleanup: { afterDays: 30, onMerge: false, onDelete: false, unchanged: false } }, projects: [] };
  cleanup.schedule(); await cleanup.idle();
  assert.ok(existsSync(changed.path), 'a busy worktree is never removed');
  busy.clear(); settings = { ...settings, projects: [{ ...inherit(h.projectId), cleanup: { mode: 'off' } }] };
  cleanup.schedule(); await cleanup.idle();
  assert.ok(existsSync(changed.path), 'a project can turn cleanup off');
  settings = { ...settings, projects: [] };
  cleanup.schedule(); await cleanup.idle();
  assert.equal(existsSync(changed.path), false, 'inactive for longer than 30 days');
  await h.send(unchanged.location, 'Continue'); await h.settle(unchanged.location);
  assert.ok(existsSync(unchanged.path), 'the next message recreates the worktree');
});

test('a pull request checks out locally or into a worktree, reusing one already on its branch', opts, async t => {
  const h = await worktreeFixture(t);
  const gh = await fakeGitHub(t);
  const bare = join(h.root, 'remote.git'); mkdirSync(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
  const url = 'https://github.com/acme/app.git';
  await gitCommand(h.project, ['remote', 'add', 'origin', url]); await gitCommand(h.project, ['config', `url.${bare}.insteadOf`, url]);
  await gitCommand(h.project, ['push', '-u', 'origin', 'main']);
  await gitCommand(h.project, ['switch', '-q', '-c', 'feature/login']); writeFileSync(join(h.project, 'login.txt'), 'login\n');
  await gitCommand(h.project, ['add', '.']); await gitCommand(h.project, ['commit', '-m', 'Login']);
  const head = await git(h.project, ['rev-parse', 'HEAD']);
  await gitCommand(h.project, ['push', 'origin', 'HEAD:refs/heads/feature/login', 'HEAD:refs/pull/5/head', 'HEAD:refs/pull/6/head']);
  await gitCommand(h.project, ['switch', '-q', 'main']); await gitCommand(h.project, ['branch', '-D', 'feature/login']);
  const pr = (number, headRefName, cross) => ({ number, title: `PR ${number}`, url: `https://github.com/acme/app/pull/${number}`, baseRefName: 'main', headRefName, state: 'OPEN',
    isCrossRepository: cross, headRepositoryOwner: { login: cross ? 'someone' : 'acme' } });
  await gh.setPrs([pr(5, 'feature/login', false), pr(6, 'main', true)]);
  const resolved = await h.worktrees.resolvePullRequest(h.projectId, 'https://github.com/acme/app/pull/5');
  assert.deepEqual([resolved.number, resolved.headBranch, resolved.crossRepository], [5, 'feature/login', false]);
  await assert.rejects(h.worktrees.resolvePullRequest(h.projectId, 'not a reference'), { message: 'Enter a pull request URL, checkout command, or #number.' });
  h.worktrees.saveProject({ ...inherit(h.projectId), setupScript: { name: 'Install', command: 'touch installed', wait: false } });
  const location = h.create();
  const checkout = await h.worktrees.preparePullRequest({ projectId: h.projectId, reference: '#5', mode: 'worktree', session: location });
  assert.equal(checkout.branch, 'feature/login'); assert.equal(checkout.isOnPullRequestHead, true);
  assert.ok(checkout.worktreePath.startsWith(join(h.root, 'worktrees', 'project')));
  assert.equal(await git(checkout.worktreePath, ['rev-parse', 'HEAD']), head);
  assert.equal(await git(checkout.worktreePath, ['branch', '--show-current']), 'feature/login');
  assert.deepEqual(h.workspace(location), { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: 'feature/login', worktreePath: checkout.worktreePath });
  await until(() => h.worktrees.setup(location)?.phase === 'done', 'the setup script');
  assert.ok(existsSync(join(checkout.worktreePath, 'installed')), 'the setup script ran in the new worktree');
  const again = await h.worktrees.preparePullRequest({ projectId: h.projectId, reference: 'gh pr checkout 5', mode: 'worktree', session: null });
  assert.equal(again.worktreePath, checkout.worktreePath, 'the existing worktree is reused');
  const fork = await h.worktrees.preparePullRequest({ projectId: h.projectId, reference: '6', mode: 'worktree', session: null });
  assert.equal(fork.branch, 'flame/pr-6/main', 'a fork gets its own local branch name');
  await assert.rejects(h.worktrees.preparePullRequest({ projectId: h.projectId, reference: '5', mode: 'local', session: null }), { message: /already (?:checked out|used by worktree)/ });
  await h.worktrees.remove(h.projectId, checkout.worktreePath).catch(() => {});
  h.sessions.remove(location, h.sessions.read(location).revision);
  await h.worktrees.remove(h.projectId, checkout.worktreePath);
  const local = h.create();
  const locally = await h.worktrees.preparePullRequest({ projectId: h.projectId, reference: '5', mode: 'local', session: local });
  assert.deepEqual([locally.branch, locally.worktreePath], ['feature/login', null]);
  assert.equal(await git(h.project, ['branch', '--show-current']), 'feature/login');
  assert.deepEqual(h.workspace(local), { mode: 'local', baseBranch: null, startFromOrigin: false, branch: 'feature/login', worktreePath: null });
  await assert.rejects(h.worktrees.preparePullRequest({ projectId: h.projectId, reference: '5', mode: 'worktree', session: null }),
    { message: 'This pull request branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree session.' });
});
