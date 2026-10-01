import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitCommand } from '../dist/backend/git/command.js';
import { availableBranchName, generatedWorktreeBranch, isTemporaryWorktreeBranch, temporaryWorktreeBranch } from '../dist/backend/worktrees/branch-names.js';
import { addWorktree, listWorktrees, removeWorktree, renameBranch, updateSubmodules } from '../dist/backend/worktrees/git-worktrees.js';
import { listRefs } from '../dist/backend/worktrees/refs.js';
import { switchRef } from '../dist/backend/worktrees/switch-ref.js';
import { validateWorkspace } from '../dist/backend/worktrees/workspace-config.js';
import { pullRequestNumber } from '../dist/backend/worktrees/pull-requests.js';
import { worktreeFolder } from '../dist/backend/worktrees/paths.js';
import { linkedWorktreeOf } from '../dist/backend/worktrees/linked-worktree.js';
import { projectSettings } from '../dist/contracts/worktrees.js';
import { reconcileInterruptedSetup } from '../dist/backend/worktrees/service.js';
import { DEFAULT_WORKTREE_SETTINGS } from '../dist/contracts/worktrees.js';

const opts = { skip: process.platform === 'win32', timeout: 30000 };
const git = async (cwd, args) => (await gitCommand(cwd, args)).stdout.toString('utf8').trim();
async function repository(t, files = 1) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flame-worktree-git-'))), project = join(root, 'project');
  mkdirSync(project); t.after(() => rmSync(root, { recursive: true, force: true }));
  await gitCommand(project, ['init', '--initial-branch=main']);
  for (const [key, value] of [['user.name', 'Flame tests'], ['user.email', 'tests@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(project, ['config', key, value]);
  for (let i = 0; i < files; i++) writeFileSync(join(project, `file-${i}.txt`), `${i}\n`);
  await gitCommand(project, ['add', '.']); await gitCommand(project, ['commit', '-m', 'Initial commit']);
  return { root, project };
}

test('worktree branch names follow T3 Code: a hex placeholder, then a normalized name with free suffixes', () => {
  assert.equal(temporaryWorktreeBranch('ABCDEF12ff'), 'flame/abcdef12');
  assert.match(temporaryWorktreeBranch(), /^flame\/[0-9a-f]{8}$/);
  assert.equal(isTemporaryWorktreeBranch('flame/0123abcd'), true);
  assert.equal(isTemporaryWorktreeBranch('flame/fix-login'), false);
  assert.equal(generatedWorktreeBranch('  "Fix Login Redirect!" '), 'flame/fix-login-redirect');
  assert.equal(generatedWorktreeBranch('refs/heads/flame/UI polish/'), 'flame/ui-polish');
  assert.equal(generatedWorktreeBranch('!!!'), 'flame/update');
  assert.equal(generatedWorktreeBranch('x'.repeat(100)).length, 'flame/'.length + 64);
  assert.equal(availableBranchName(['a', 'a-1'], 'a'), 'a-2');
  assert.equal(availableBranchName(['a', ...Array.from({ length: 100 }, (_, i) => `a-${i + 1}`)], 'a'), null);
});

test('worktree folders sit under the repository name, with slashes flattened and collisions suffixed', t => {
  const base = mkdtempSync(join(tmpdir(), 'flame-worktree-folder-')); t.after(() => rmSync(base, { recursive: true, force: true }));
  assert.equal(worktreeFolder(base, '/code/app', 'flame/fix-a'), join(base, 'app', 'flame-fix-a'));
  mkdirSync(join(base, 'app', 'flame-fix-a'), { recursive: true });
  assert.equal(worktreeFolder(base, '/code/app', 'flame/fix-a'), join(base, 'app', 'flame-fix-a-2'));
});

test('a worktree is added with checkout progress, listed, and removed even when its folder is already gone', opts, async t => {
  const { root, project } = await repository(t, 400);
  const path = join(root, 'wt'), progress = [];
  await addWorktree(project, { path, ref: 'main', newBranch: 'flame/abcd1234' }, { onProgress: (percent, done, total) => progress.push([percent, done, total]) });
  assert.ok(progress.length > 0 && progress.at(-1)[0] === 100 && progress.at(-1)[2] === 400, JSON.stringify(progress.slice(-2)));
  const listed = await listWorktrees(project);
  assert.deepEqual(listed.map(tree => [tree.path, tree.branch]), [[project, 'main'], [path, 'flame/abcd1234']]);
  assert.equal(await renameBranch(path, 'flame/abcd1234', 'main'), 'main-1', 'a taken name gets the first free suffix');
  await removeWorktree(project, path, false);
  assert.equal(existsSync(path), false);
  await removeWorktree(project, path, false); // Twice is fine.
  await addWorktree(project, { path, ref: 'main-1' });
  rmSync(path, { recursive: true, force: true });
  await removeWorktree(project, path, false);
  assert.equal((await listWorktrees(project)).length, 1, 'the stale registration was pruned');
});

test('submodules are populated in a new worktree, skipped when disabled, and reported absent without .gitmodules', opts, async t => {
  const { root, project } = await repository(t);
  assert.equal(await updateSubmodules(project, 'recursive'), 'absent');
  const library = join(root, 'library'); mkdirSync(library);
  await gitCommand(library, ['init', '--initial-branch=main']); writeFileSync(join(library, 'lib.txt'), 'lib\n');
  await gitCommand(library, ['add', '.']); await gitCommand(library, ['-c', 'user.name=x', '-c', 'user.email=x@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'lib']);
  await gitCommand(project, ['-c', 'protocol.file.allow=always', 'submodule', 'add', library, 'vendor/library']); await gitCommand(project, ['commit', '-m', 'Add submodule']);
  const path = join(root, 'wt');
  await addWorktree(project, { path, ref: 'main', newBranch: 'flame/aaaa0000' });
  assert.equal(await updateSubmodules(path, 'none'), 'disabled');
  assert.equal(existsSync(join(path, 'vendor/library/lib.txt')), false);
  const lines = [];
  // Local submodule clones need the file protocol, which Git only allows from user configuration.
  const home = process.env.HOME; process.env.HOME = root; writeFileSync(join(root, '.gitconfig'), '[protocol "file"]\n\tallow = always\n');
  t.after(() => { process.env.HOME = home; });
  assert.equal(await updateSubmodules(path, 'recursive', { onLine: line => lines.push(line) }), 'updated');
  assert.ok(existsSync(join(path, 'vendor/library/lib.txt')));
  assert.ok(lines.some(line => line.includes("Submodule path 'vendor/library'")), lines.join('\n'));
});

test('the branch list puts current and default first, hides remote copies of local branches, and marks other worktrees', opts, async t => {
  const { root, project } = await repository(t);
  const bare = join(root, 'remote.git'); mkdirSync(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
  await gitCommand(project, ['remote', 'add', 'origin', bare]);
  await gitCommand(project, ['branch', 'feature/remote-only']); await gitCommand(project, ['push', 'origin', 'main', 'feature/remote-only']);
  await gitCommand(project, ['branch', '-D', 'feature/remote-only']); await gitCommand(project, ['remote', 'set-head', 'origin', 'main']);
  await gitCommand(project, ['switch', '-c', 'work']);
  const path = join(root, 'wt'); await addWorktree(project, { path, ref: 'main', newBranch: 'flame/aaaa1111' });
  const list = await listRefs(project, '', 50);
  assert.deepEqual(list.refs.map(ref => [ref.name, ref.current, ref.isDefault, ref.remote, ref.worktreePath]), [
    ['work', true, false, null, null], ['main', false, true, null, null], ['flame/aaaa1111', false, false, null, path], ['origin/feature/remote-only', false, false, 'origin', null],
  ]);
  assert.equal(list.current, 'work'); assert.equal(list.defaultBranch, 'main');
  const fromWorktree = await listRefs(path, 'flame', 50);
  assert.deepEqual(fromWorktree.refs.map(ref => [ref.name, ref.current, ref.worktreePath]), [['flame/aaaa1111', true, null]], 'a folder does not point at itself');
  assert.equal((await listRefs(project, '', 1)).total, 4);
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'flame-not-git-'))); t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.deepEqual(await listRefs(plain, '', 5), { repository: false, refs: [], total: 0, current: null, defaultBranch: null });
});

test('switching branches creates, tracks remote branches, and explains a branch held by another worktree', opts, async t => {
  const { root, project } = await repository(t);
  const bare = join(root, 'remote.git'); mkdirSync(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
  await gitCommand(project, ['remote', 'add', 'origin', bare]);
  await gitCommand(project, ['branch', 'shared']); await gitCommand(project, ['push', 'origin', 'shared']); await gitCommand(project, ['branch', '-D', 'shared']); await gitCommand(project, ['fetch', 'origin']);
  assert.equal(await switchRef(project, 'origin/shared', false), 'shared');
  assert.equal(await git(project, ['rev-parse', '--abbrev-ref', '@{upstream}']), 'origin/shared');
  assert.equal(await switchRef(project, 'new-work', true), 'new-work');
  await assert.rejects(switchRef(project, 'new-work', true), { message: 'A branch named new-work already exists.' });
  await assert.rejects(switchRef(project, 'bad..name', false), { message: 'bad..name is not a valid branch name.' });
  const path = join(root, 'wt'); await addWorktree(project, { path, ref: 'main' });
  await assert.rejects(switchRef(project, 'main', false), { message: new RegExp(`^main is already checked out in ${path}`) });
});

test('a session may work in the checkout, a new worktree from a branch with commits, or an existing worktree of the repository', opts, async t => {
  const { root, project } = await repository(t);
  assert.deepEqual(await validateWorkspace(project, { mode: 'local', baseBranch: 'x', startFromOrigin: true, branch: 'main', worktreePath: null }),
    { mode: 'local', baseBranch: null, startFromOrigin: false, branch: 'main', worktreePath: null });
  assert.deepEqual(await validateWorkspace(project, { mode: 'worktree', baseBranch: 'main', startFromOrigin: true, branch: 'ignored', worktreePath: null }),
    { mode: 'worktree', baseBranch: 'main', startFromOrigin: true, branch: null, worktreePath: null });
  assert.deepEqual(await validateWorkspace(project, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: null }),
    { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: null }, 'an unnamed base is chosen when the worktree is created');
  await assert.rejects(validateWorkspace(project, { mode: 'worktree', baseBranch: 'missing', startFromOrigin: false, branch: null, worktreePath: null }), { code: 'INVALID' });
  const path = join(root, 'wt'); await addWorktree(project, { path, ref: 'main', newBranch: 'flame/aaaa2222' });
  assert.deepEqual(await validateWorkspace(project, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: path }),
    { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: 'flame/aaaa2222', worktreePath: path });
  await assert.rejects(validateWorkspace(project, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: project }), { code: 'NOT_FOUND' });
  await assert.rejects(validateWorkspace(project, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: root }), { code: 'NOT_FOUND' });
  const plain = realpathSync(mkdtempSync(join(tmpdir(), 'flame-not-git-'))); t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.deepEqual(await validateWorkspace(plain, { mode: 'worktree', baseBranch: 'main', startFromOrigin: false, branch: null, worktreePath: null }),
    { mode: 'local', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: null }, 'outside a repository a new worktree falls back to the checkout');
  await assert.rejects(validateWorkspace(plain, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: path }), { message: 'A separate worktree requires a Git repository.' });
});

test('a folder counts as the project\'s worktree only when the repository still registers it there', opts, async t => {
  const { root, project } = await repository(t);
  const path = join(root, 'wt'); await addWorktree(project, { path, ref: 'main', newBranch: 'flame/aaaa3333' });
  assert.equal(linkedWorktreeOf(project, path), path);
  assert.equal(linkedWorktreeOf(path, path), path, 'asked from another worktree of the same repository');
  assert.equal(linkedWorktreeOf(project, project), null, 'the main checkout is not a linked worktree');
  assert.equal(linkedWorktreeOf(project, root), null);
  const { project: other } = await repository(t);
  assert.equal(linkedWorktreeOf(other, path), null, 'another repository\'s worktree is refused');
  const moved = join(root, 'moved'); await gitCommand(project, ['worktree', 'move', path, moved]);
  mkdirSync(path); writeFileSync(join(path, '.git'), `gitdir: ${join(project, '.git', 'worktrees', 'wt')}\n`);
  assert.equal(linkedWorktreeOf(project, path), null, 'a stale pointer to metadata that now belongs elsewhere is refused');
});

test('change request references are read from numbers, URLs and checkout commands', () => {
  for (const [reference, number] of [['#42', 42], ['42', 42], ['https://github.com/o/r/pull/42', 42], ['https://github.com/o/r/pull/42/files', 42],
    ['https://gitlab.com/g/p/-/merge_requests/7', 7], ['gh pr checkout 42', 42], ['glab mr checkout https://gitlab.com/g/p/-/merge_requests/9', 9]]) assert.equal(pullRequestNumber(reference), number, reference);
  for (const reference of ['', 'feature/x', 'https://github.com/o/r/issues/42', '#']) assert.equal(pullRequestNumber(reference), null, reference);
});

test('project settings override the defaults field by field, and cleanup can be turned off per project', () => {
  const defaults = { ...DEFAULT_WORKTREE_SETTINGS, cleanup: { afterDays: 30, onMerge: true, onDelete: true, unchanged: false } };
  const id = '11111111-1111-4111-8111-111111111111', inherit = { projectId: id, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null, setupScript: null };
  assert.deepEqual(projectSettings({ defaults, projects: [] }, id), { defaultMode: 'local', startFromOrigin: true, submodules: 'recursive', cleanup: defaults.cleanup, setupScript: null });
  const script = { name: 'Install', command: 'bun install', wait: true };
  assert.deepEqual(projectSettings({ defaults, projects: [{ ...inherit, defaultMode: 'worktree', startFromOrigin: false, cleanup: { mode: 'off' }, setupScript: script }] }, id),
    { defaultMode: 'worktree', startFromOrigin: false, submodules: 'recursive', cleanup: { afterDays: null, onMerge: false, onDelete: false, unchanged: false }, setupScript: script });
  const custom = { afterDays: null, onMerge: false, onDelete: false, unchanged: true };
  assert.deepEqual(projectSettings({ defaults, projects: [{ ...inherit, cleanup: { mode: 'custom', rules: custom } }] }, id).cleanup, custom);
});

test('a setup cut short by a restart is failed, or done when the agent had already started', () => {
  const stages = status => ['fetch', 'checkout', 'submodules', 'setup-script', 'agent'].map(id => ({ id, status: id === 'agent' ? status : 'done', startedAt: 1, endedAt: null, percent: null, detail: null, tail: [] }));
  const base = { turnId: 't', phase: 'running', startedAt: 1, endedAt: null, branch: 'flame/aaaa0000', baseRef: 'main', worktreePath: null, setupScript: null, error: null, sequence: 5 };
  const failed = reconcileInterruptedSetup({ ...base, stages: stages('pending') });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.error, 'Flame restarted before the worktree setup finished. Send the message again.');
  assert.equal(failed.stages.at(-1).detail, 'interrupted by a server restart');
  assert.ok(failed.sequence > base.sequence);
  const done = reconcileInterruptedSetup({ ...base, stages: [...stages('done').slice(0, 3), { ...stages('done')[3], status: 'running' }, stages('done')[4]] });
  assert.equal(done.phase, 'done'); assert.equal(done.error, null); assert.equal(done.stages[3].status, 'failed');
});
