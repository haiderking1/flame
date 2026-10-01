import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('./helpers/contracts-alias.mjs', import.meta.url);
const logic = await import('../src/renderer/components/composer/workspace/workspaceLogic.ts');
const keys = await import('../src/renderer/backend/workspaceKey.ts');

const local = { mode: 'local', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: null };
const pending = { mode: 'worktree', baseBranch: 'main', startFromOrigin: true, branch: null, worktreePath: null };
const worktree = { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: 'flame/fix', worktreePath: '/w/app/flame-fix' };
const project = '11111111-1111-4111-8111-111111111111', session = '22222222-2222-4222-8222-222222222222';
const summary = (id, workspace, updatedAt, settledAt = null) => ({ projectId: project, sessionId: id, title: id, createdAt: 0, updatedAt, revision: 0, settledAt, workspace });

test('workspace labels follow T3 Code', () => {
  assert.equal(logic.modeLabel('local'), 'Current checkout');
  assert.equal(logic.modeLabel('worktree'), 'New worktree');
  assert.equal(logic.currentWorkspaceLabel('/w'), 'Current worktree');
  assert.equal(logic.lockedWorkspaceLabel(worktree), 'Worktree');
  assert.equal(logic.lockedWorkspaceLabel(pending), 'New worktree', 'a worktree still being created reads as new');
  assert.equal(logic.lockedWorkspaceLabel(local), 'Local checkout');
  assert.equal(logic.folderName('/w/app/flame-fix/'), 'flame-fix');
});

test('the branch button names the base of a new worktree, from origin when asked', () => {
  assert.equal(logic.branchTriggerLabel(pending, 'main'), 'From origin/main');
  assert.equal(logic.branchTriggerLabel({ ...pending, startFromOrigin: false }, 'main'), 'From main');
  assert.equal(logic.branchTriggerLabel({ ...pending, baseBranch: 'origin/dev' }, 'main'), 'From origin/dev');
  assert.equal(logic.branchTriggerLabel({ ...pending, baseBranch: null }, 'main'), 'Select ref');
  assert.equal(logic.branchTriggerLabel(worktree, 'flame/renamed'), 'flame/renamed');
  assert.equal(logic.branchTriggerLabel(local, null), 'Select ref');
});

test('choosing a branch moves to its worktree, back to the checkout for the default branch, or checks it out in place', () => {
  assert.deepEqual(logic.branchSelection(local, '/p', { isDefault: false, worktreePath: '/w/x' }), { worktreePath: '/w/x', checkout: false });
  assert.deepEqual(logic.branchSelection(worktree, '/p', { isDefault: false, worktreePath: '/p' }), { worktreePath: null, checkout: false });
  assert.deepEqual(logic.branchSelection(worktree, '/p', { isDefault: true, worktreePath: null }), { worktreePath: null, checkout: true });
  assert.deepEqual(logic.branchSelection(worktree, '/p', { isDefault: false, worktreePath: null }), { worktreePath: '/w/app/flame-fix', checkout: true });
  assert.deepEqual(logic.branchSelection(local, '/p', { isDefault: true, worktreePath: null }), { worktreePath: null, checkout: true });
  assert.deepEqual(logic.movedWorkspace(null, 'main'), { ...local, branch: 'main' });
  assert.deepEqual(logic.movedWorkspace('/w/x', 'x'), { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: 'x', worktreePath: '/w/x' });
});

test('the previous worktree is the most recently active other worktree in the project', () => {
  const sessions = [summary('a', worktree, 5), summary('b', { ...worktree, branch: 'b', worktreePath: '/w/b' }, 9), summary('c', { ...worktree, worktreePath: '/w/c' }, 20, 1),
    { ...summary('d', { ...worktree, worktreePath: '/w/d' }, 30), projectId: '33333333-3333-4333-8333-333333333333' }, summary('e', local, 40)];
  assert.deepEqual(logic.previousWorktree(sessions, project, null), { branch: 'b', worktreePath: '/w/b' });
  assert.deepEqual(logic.previousWorktree(sessions, project, '/w/b'), { branch: 'flame/fix', worktreePath: '/w/app/flame-fix' });
  assert.equal(logic.previousWorktreeLabel({ branch: 'b', worktreePath: '/w/b' }), 'Previous worktree (b)');
  assert.equal(logic.previousWorktreeLabel({ branch: null, worktreePath: '/w/b' }), 'Previous worktree');
});

test('a setup card shows while running, stays when something failed, and goes once a clean setup hands over', () => {
  const stage = (id, status) => ({ id, status, startedAt: 1, endedAt: 2, percent: null, detail: null, tail: [] });
  const snapshot = (phase, statuses) => ({ turnId: 't', phase, startedAt: 1, endedAt: null, branch: 'flame/x', baseRef: 'main', worktreePath: null, setupScript: null, error: null, sequence: 1,
    stages: ['fetch', 'checkout', 'submodules', 'setup-script', 'agent'].map((id, index) => stage(id, statuses[index])) });
  assert.ok(logic.visibleSetup(snapshot('running', ['done', 'running', 'pending', 'pending', 'pending'])));
  assert.equal(logic.visibleSetup(snapshot('done', ['skipped', 'done', 'skipped', 'done', 'done'])), null);
  assert.ok(logic.visibleSetup(snapshot('done', ['skipped', 'done', 'skipped', 'failed', 'done'])), 'a failed script stays visible');
  assert.ok(logic.visibleSetup(snapshot('done', ['skipped', 'done', 'skipped', 'running', 'pending'])), 'nothing collapses before the agent has the turn');
  assert.ok(logic.visibleSetup(snapshot('failed', ['done', 'failed', 'skipped', 'skipped', 'skipped'])));
  assert.ok(logic.visibleSetup(snapshot('cancelled', ['done', 'done', 'skipped', 'failed', 'skipped'])));
  assert.equal(logic.visibleSetup(null), null);
});

test('only the last session in a worktree may delete it, and branch mismatches are noticed only in the checkout', () => {
  const mine = summary('a', worktree, 1), other = summary('b', worktree, 2);
  assert.equal(logic.orphanedWorktree(mine, [mine]), '/w/app/flame-fix');
  assert.equal(logic.orphanedWorktree(mine, [mine, other]), null);
  assert.equal(logic.orphanedWorktree(summary('c', local, 1), []), null);
  assert.deepEqual(logic.branchMismatch({ ...local, branch: 'main' }, 'other'), { threadBranch: 'main', currentBranch: 'other' });
  assert.equal(logic.branchMismatch({ ...local, branch: 'main' }, 'main'), null);
  assert.equal(logic.branchMismatch(worktree, 'other'), null);
  assert.equal(logic.branchMismatch(local, 'other'), null);
  assert.equal(logic.mismatchKey('s', { threadBranch: 'a', currentBranch: 'b' }), 's:a:b');
  assert.equal(logic.showMismatch({ dismissed: false, composerHasContent: false, shown: false }), false);
  assert.equal(logic.showMismatch({ dismissed: false, composerHasContent: true, shown: false }), true);
  assert.equal(logic.showMismatch({ dismissed: false, composerHasContent: false, shown: true }), true);
  assert.equal(logic.showMismatch({ dismissed: true, composerHasContent: true, shown: true }), false);
});

test('pull request references are recognised in the branch search', () => {
  for (const query of ['#42', 'gh pr checkout 42', 'https://github.com/o/r/pull/42', 'https://gitlab.com/g/p/-/merge_requests/7']) assert.equal(logic.looksLikePullRequest(query), true, query);
  for (const query of ['42', 'feature/x', '#', 'https://github.com/o/r/issues/1']) assert.equal(logic.looksLikePullRequest(query), false, query);
});

test('workspace keys round-trip project checkouts, session worktrees and chosen worktree folders', () => {
  assert.deepEqual(keys.workspaceTarget(keys.workspaceKey(project)), { projectId: project });
  assert.deepEqual(keys.workspaceTarget(keys.workspaceKey(project, session)), { projectId: project, sessionId: session });
  assert.deepEqual(keys.workspaceTarget(keys.worktreeKey(project, '/w/a:b#c')), { projectId: project, worktreePath: '/w/a:b#c' });
  assert.equal(keys.workspaceProject(keys.workspaceKey(project, session)), project);
});
