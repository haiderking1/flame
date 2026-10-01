import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
// The renderer imports contracts through the bundler's @contracts alias; resolve it the same way here.
register('./helpers/contracts-alias.mjs', import.meta.url);
const { resolveQuickAction, buildMenuItems, menuDisabledReason, requiresDefaultBranchConfirmation, defaultBranchCopy, firstProgressLabel } = await import('../src/renderer/components/workspace/git/gitActionLogic.ts');

const base = { projectId: 'p', repository: true, root: '/r', branch: 'feature/x', upstream: 'origin/feature/x', remotes: ['origin'], files: [], ahead: 0, behind: 0, aheadOfDefault: 0,
  defaultBranch: 'main', isDefaultBranch: false, hasPrimaryRemote: true, provider: { kind: 'github', name: 'GitHub', host: 'github.com' }, pr: null };
const status = extra => ({ ...base, ...extra });
const file = { path: 'a.ts', originalPath: null, index: ' ', worktree: 'M' };
const openPr = { number: 3, title: 't', url: 'https://github.com/a/b/pull/3', baseBranch: 'main', headBranch: 'feature/x', state: 'open' };
const quick = extra => { const action = resolveQuickAction(status(extra), false); return [action.label, action.kind, action.action ?? action.hint ?? null]; };

test('the header button picks t3code\'s next step for every repository state', () => {
  assert.deepEqual(quick({ files: [file] }), ['Commit, push & PR', 'run_action', 'commit_push_pr']);
  assert.deepEqual(quick({ files: [file], pr: openPr }), ['Commit & push', 'run_action', 'commit_push']);
  assert.deepEqual(quick({ files: [file], isDefaultBranch: true, branch: 'main' }), ['Commit & push', 'run_action', 'commit_push']);
  assert.deepEqual(quick({ files: [file], upstream: null, hasPrimaryRemote: false, remotes: [] }), ['Commit', 'run_action', 'commit']);
  assert.deepEqual(quick({ files: [file], provider: { kind: 'unknown', name: 'Git host', host: 'git.example' } }), ['Commit & push', 'run_action', 'commit_push'], 'no PR offer without CLI support');
  assert.deepEqual(quick({ upstream: null, hasPrimaryRemote: false, remotes: [] }), ['Publish repository', 'open_publish', null]);
  assert.deepEqual(quick({ upstream: null }), ['Push', 'show_hint', 'No local commits to push.']);
  assert.deepEqual(quick({ upstream: null, ahead: 2 }), ['Push & create PR', 'run_action', 'create_pr']);
  assert.deepEqual(quick({ upstream: null, ahead: 2, isDefaultBranch: true, branch: 'main' }), ['Push', 'run_action', 'commit_push']);
  assert.deepEqual(quick({ ahead: 1, behind: 1 }), ['Sync branch', 'show_hint', 'Branch has diverged from upstream. Rebase/merge first.']);
  assert.deepEqual(quick({ behind: 2 }), ['Pull', 'run_pull', null]);
  assert.deepEqual(quick({ ahead: 1 }), ['Push & create PR', 'run_action', 'create_pr']);
  assert.deepEqual(quick({ ahead: 1, pr: openPr }), ['Push', 'run_action', 'push']);
  assert.deepEqual(quick({ pr: openPr }), ['View PR', 'open_pr', null]);
  assert.deepEqual(quick({ aheadOfDefault: 3 }), ['Create PR', 'run_action', 'create_pr']);
  assert.deepEqual(quick({}), ['Commit', 'show_hint', 'Branch is up to date. No action needed.']);
  assert.deepEqual(quick({ branch: null }), ['Commit', 'show_hint', 'Create and checkout a branch before pushing or opening a pull request.']);
  assert.deepEqual(quick({ files: [file], provider: { kind: 'gitlab', name: 'GitLab', host: 'gitlab.com' } }), ['Commit, push & MR', 'run_action', 'commit_push_pr']);
  assert.equal(resolveQuickAction(status({ files: [file] }), true).hint, 'Git action in progress.');
  assert.equal(resolveQuickAction(null, false).hint, 'Git status is unavailable.');
});

test('menu items and their disabled reasons follow t3code', () => {
  const items = buildMenuItems(status({}), false);
  assert.deepEqual(items.map(item => [item.label, item.disabled]), [['Commit', true], ['Push', true], ['Create PR', true]]);
  assert.equal(menuDisabledReason(items[0], status({}), false), 'Worktree is clean. Make changes before committing.');
  assert.equal(menuDisabledReason(items[1], status({}), false), 'No local commits to push.');
  assert.equal(menuDisabledReason(items[2], status({}), false), 'No local commits to include in a pull request.');
  assert.equal(menuDisabledReason(items[1], status({ behind: 1 }), false), 'Branch is behind upstream. Pull/rebase before pushing.');
  assert.equal(menuDisabledReason(buildMenuItems(status({ files: [file] }), false)[2], status({ files: [file] }), false), 'Commit local changes before creating a pull request.');
  assert.deepEqual(buildMenuItems(status({ pr: openPr }), false)[2], { id: 'pr', label: 'View PR', icon: 'pr', kind: 'open_pr', disabled: false });
  assert.deepEqual(buildMenuItems(status({ upstream: null, hasPrimaryRemote: false, remotes: [] }), false).map(item => item.id), ['commit']);
  assert.deepEqual(buildMenuItems(status({ provider: null }), false).map(item => item.id), ['commit', 'push']);
  assert.equal(buildMenuItems(status({ ahead: 1 }), false)[1].disabled, false);
  assert.equal(menuDisabledReason(buildMenuItems(status({ ahead: 1 }), true)[1], status({ ahead: 1 }), true), 'Git action in progress.');
});

test('default-branch confirmation copy and the first progress label', () => {
  assert.equal(requiresDefaultBranchConfirmation('commit', true), false);
  for (const action of ['push', 'create_pr', 'commit_push', 'commit_push_pr']) assert.equal(requiresDefaultBranchConfirmation(action, true), true);
  assert.equal(requiresDefaultBranchConfirmation('push', false), false);
  const words = { shortLabel: 'PR', singular: 'pull request' };
  assert.deepEqual(defaultBranchCopy('commit_push', 'main', true, words), { title: 'Commit & push to default branch?', continueLabel: 'Commit & push to main',
    description: 'This action will commit and push changes on "main". You can continue on this branch or create a feature branch and run the same action there.' });
  assert.equal(defaultBranchCopy('push', 'main', false, words).title, 'Push to default branch?');
  assert.equal(defaultBranchCopy('create_pr', 'main', false, words).continueLabel, 'Push & create PR');
  assert.equal(defaultBranchCopy('commit_push_pr', 'main', true, words).title, 'Commit, push & create PR from default branch?');
  assert.equal(firstProgressLabel({ action: 'commit', message: '', featureBranch: false, status: status({ files: [file] }) }), 'Generating commit message...');
  assert.equal(firstProgressLabel({ action: 'commit_push', message: 'x', featureBranch: false, status: status({ files: [file] }) }), 'Committing...');
  assert.equal(firstProgressLabel({ action: 'commit_push', message: '', featureBranch: false, status: status({}) }), 'Pushing...');
  assert.equal(firstProgressLabel({ action: 'create_pr', message: '', featureBranch: false, status: status({}) }), 'Preparing PR...');
  assert.equal(firstProgressLabel({ action: 'commit', message: '', featureBranch: true, status: status({}) }), 'Preparing feature branch...');
});
