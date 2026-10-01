import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gitCommand } from '../dist/backend/git/command.js';
import { worktreeFixture, bashCall, message, until, git } from './helpers/worktreeFixture.mjs';

const opts = { timeout: 30000, skip: process.platform === 'win32' };
const output = (body, id = 'call_test') => JSON.parse(body.input.find(item => item.type === 'function_call_output' && item.call_id === id).output);
const stage = (snapshot, id) => snapshot.stages.find(item => item.id === id);

test('a first message creates the session worktree on a placeholder branch, the agent works there, and the branch is named', opts, async t => {
  let seen;
  const h = await worktreeFixture(t, { respond: (body, n) => {
    if (n === 1) { seen = body.instructions; return [bashCall('pwd; git branch --show-current')]; }
    seen = output(body).output; return [message('Done.')];
  } });
  const location = h.create();
  await h.newWorktree(location);
  assert.equal(h.workspace(location).worktreePath, null, 'nothing is created before the first message');
  await h.send(location);
  assert.equal((await h.settle(location)).status, 'completed');
  const { worktreePath, mode } = h.workspace(location);
  assert.equal(mode, 'worktree');
  assert.ok(worktreePath.startsWith(join(h.root, 'worktrees', 'project', 'flame-')), worktreePath);
  assert.ok(existsSync(join(worktreePath, 'README.md')), 'the worktree has the base branch checked out');
  assert.match(seen, new RegExp(`^${worktreePath}\\n`), 'Bash ran in the worktree');
  assert.ok(h.requests[0].instructions.endsWith(`<cwd>\n${worktreePath}\n</cwd>`), 'the agent is told it works in the worktree');
  const setup = h.worktrees.setup(location);
  assert.equal(setup.phase, 'done');
  assert.deepEqual(setup.stages.map(item => [item.id, item.status]), [['fetch', 'skipped'], ['checkout', 'done'], ['submodules', 'skipped'], ['setup-script', 'skipped'], ['agent', 'done']]);
  assert.equal(stage(setup, 'submodules').detail, 'none');
  assert.ok(h.changed.includes(worktreePath), 'clients recheck Git status for the new worktree');
  await until(() => h.workspace(location).branch === 'flame/fix-login-redirect', 'the branch to be named');
  assert.equal(await git(worktreePath, ['branch', '--show-current']), 'flame/fix-login-redirect');
  assert.match(h.named[0].prompt, /Fix the login redirect/);
  await until(() => h.worktrees.setup(location).branch === 'flame/fix-login-redirect', 'the setup card to show the named branch');
  assert.equal(await git(h.project, ['config', '--get', 'branch.flame/fix-login-redirect.gh-merge-base']), 'main', 'change requests target the base branch');
});

test('the setup script runs in the new worktree before the agent when asked to wait, and its failure does not stop the response', opts, async t => {
  let ready = false;
  const h = await worktreeFixture(t, { respond: () => { ready = existsSync(join(h.workspace(location).worktreePath, 'setup.txt')); return [message('Done.')]; } });
  h.worktrees.saveProject({ projectId: h.projectId, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null,
    setupScript: { name: 'Install', command: 'printf "%s|%s" "$FLAME_PROJECT_ROOT" "$FLAME_WORKTREE_PATH" > setup.txt; echo installing; exit 3', wait: true } });
  const location = h.create();
  await h.newWorktree(location);
  await h.send(location);
  assert.equal((await h.settle(location)).status, 'completed');
  const path = h.workspace(location).worktreePath;
  assert.ok(ready, 'the agent waited for the script');
  assert.equal(readFileSync(join(path, 'setup.txt'), 'utf8'), `${h.project}|${path}`);
  const setup = h.worktrees.setup(location);
  assert.equal(setup.phase, 'done');
  assert.deepEqual(setup.setupScript, { name: 'Install', command: setup.setupScript.command });
  assert.equal(stage(setup, 'setup-script').status, 'failed');
  assert.equal(stage(setup, 'setup-script').detail, 'exit 3');
  assert.deepEqual(stage(setup, 'setup-script').tail, ['installing']);
});

test('stopping the response during setup removes the worktree and its placeholder branch, and the next message retries', opts, async t => {
  const h = await worktreeFixture(t);
  h.worktrees.saveProject({ projectId: h.projectId, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null, setupScript: { name: 'Slow', command: 'sleep 30', wait: true } });
  const location = h.create();
  await h.newWorktree(location);
  const id = await h.send(location);
  const running = await until(() => { const setup = h.worktrees.setup(location); return setup && stage(setup, 'setup-script').status === 'running' && setup; }, 'the setup script');
  h.turns.stop(location, id);
  const turn = await h.settle(location);
  assert.equal(turn.status, 'cancelled');
  assert.equal(turn.message, 'Worktree setup cancelled.');
  assert.equal(existsSync(running.worktreePath), false, 'the worktree folder is gone');
  assert.equal(await git(h.project, ['branch', '--list', running.branch]), '', 'the placeholder branch is gone');
  assert.deepEqual(h.workspace(location), { mode: 'worktree', baseBranch: 'main', startFromOrigin: false, branch: null, worktreePath: null });
  assert.equal(h.worktrees.setup(location).phase, 'cancelled');
  h.worktrees.saveProject({ projectId: h.projectId, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null, setupScript: null });
  await h.send(location, 'Try again');
  assert.equal((await h.settle(location)).status, 'completed');
  assert.ok(existsSync(h.workspace(location).worktreePath));
});

test('"work locally" abandons the setup and the response continues in the project checkout', opts, async t => {
  let cwd;
  const h = await worktreeFixture(t, { respond: (body, n) => n === 1 ? [bashCall('pwd')] : (cwd = output(body).output.trim(), [message('Done.')]) });
  h.worktrees.saveProject({ projectId: h.projectId, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null, setupScript: { name: 'Slow', command: 'sleep 30', wait: true } });
  const location = h.create();
  await h.newWorktree(location);
  await h.send(location);
  const running = await until(() => { const setup = h.worktrees.setup(location); return setup && stage(setup, 'setup-script').status === 'running' && setup; }, 'the setup script');
  assert.equal(h.worktrees.workLocally(location), true);
  assert.equal((await h.settle(location)).status, 'completed');
  assert.equal(cwd, h.project, 'Bash ran in the project checkout');
  assert.equal(h.workspace(location).mode, 'local');
  assert.equal(existsSync(running.worktreePath), false);
  assert.equal(h.worktrees.setup(location).phase, 'cancelled');
  assert.equal(h.worktrees.workLocally(location), false, 'nothing is left to abandon');
});

test('a new worktree without a chosen base starts from the branch checked out when there is no default branch', opts, async t => {
  const h = await worktreeFixture(t);
  await gitCommand(h.project, ['switch', '-q', '-c', 'develop']);
  writeFileSync(join(h.project, 'develop.txt'), 'develop\n'); await gitCommand(h.project, ['add', '.']); await gitCommand(h.project, ['commit', '-m', 'Develop']);
  const location = h.create();
  await h.newWorktree(location, { baseBranch: null });
  await h.send(location);
  assert.equal((await h.settle(location)).status, 'completed');
  assert.ok(existsSync(join(h.workspace(location).worktreePath, 'develop.txt')));
  assert.equal(h.worktrees.setup(location).baseRef, 'develop');
});

test('a failed setup fails the response with the reason and keeps the session ready to retry', opts, async t => {
  const h = await worktreeFixture(t);
  await gitCommand(h.project, ['branch', 'feature']);
  const location = h.create();
  await h.newWorktree(location, { baseBranch: 'feature' });
  await gitCommand(h.project, ['branch', '-D', 'feature']);
  await h.send(location);
  const turn = await h.settle(location);
  assert.equal(turn.status, 'failed');
  assert.equal(turn.message, 'Worktree setup failed: The base branch feature has no commit to start a worktree from.');
  assert.equal(h.worktrees.setup(location).phase, 'failed');
  assert.equal(h.workspace(location).worktreePath, null);
  assert.equal(h.requests.length, 0, 'the model was never asked');
});

test('"start from origin" checks out the latest commit of the base branch on origin', opts, async t => {
  const h = await worktreeFixture(t);
  const bare = join(h.root, 'remote.git'); mkdirSync(bare);
  await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
  await gitCommand(h.project, ['remote', 'add', 'origin', bare]); await gitCommand(h.project, ['push', '-u', 'origin', 'main']);
  const clone = join(h.root, 'clone'); await gitCommand(h.root, ['clone', bare, clone]);
  for (const [key, value] of [['user.name', 'Other'], ['user.email', 'other@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(clone, ['config', key, value]);
  writeFileSync(join(clone, 'new.txt'), 'upstream\n'); await gitCommand(clone, ['add', '.']); await gitCommand(clone, ['commit', '-m', 'Upstream change']); await gitCommand(clone, ['push']);
  const upstream = await git(clone, ['rev-parse', 'HEAD']);
  const location = h.create();
  await h.newWorktree(location, { startFromOrigin: true });
  await h.send(location);
  assert.equal((await h.settle(location)).status, 'completed');
  const path = h.workspace(location).worktreePath;
  assert.equal(await git(path, ['rev-parse', 'HEAD']), upstream);
  assert.notEqual(await git(h.project, ['rev-parse', 'main']), upstream, 'the local branch was not moved');
  assert.equal(stage(h.worktrees.setup(location), 'fetch').detail, `origin/main at ${upstream.slice(0, 7)}`);
});

test('a deleted worktree folder is recreated from its branch before the next response', opts, async t => {
  let cwd;
  const h = await worktreeFixture(t, { respond: (body, n) => n % 2 === 1 ? [bashCall('pwd', `call_${n}`)] : (cwd = output(body, `call_${n - 1}`).output.trim(), [message('Done.')]) });
  const location = h.create();
  await h.newWorktree(location);
  await h.send(location); await h.settle(location);
  const path = h.workspace(location).worktreePath;
  await until(() => h.workspace(location).branch === 'flame/fix-login-redirect', 'the branch to be named');
  rmSync(path, { recursive: true, force: true });
  await h.send(location, 'Continue');
  assert.equal((await h.settle(location)).status, 'completed');
  assert.equal(cwd, path);
  assert.equal(await git(path, ['branch', '--show-current']), 'flame/fix-login-redirect');
  assert.equal(h.worktrees.setup(location), null, 'the finished setup card is cleared by the follow-up message');
});

test('a thread in the project checkout records the branch it runs on', opts, async t => {
  const h = await worktreeFixture(t);
  const location = h.create();
  await h.send(location); await h.settle(location);
  assert.equal(h.workspace(location).branch, 'main');
  await gitCommand(h.project, ['switch', '-q', '-c', 'other']);
  await h.send(location, 'Again'); await h.settle(location);
  assert.deepEqual(h.workspace(location), { mode: 'local', baseBranch: null, startFromOrigin: false, branch: 'other', worktreePath: null });
});

test('after a response, the session follows a branch the agent switched its worktree to', opts, async t => {
  const h = await worktreeFixture(t, { namer: { branch: () => new Promise(() => {}) }, respond: (_body, n) => n === 1 ? [bashCall('git switch -q -c feature/agent-made')] : [message('Switched.')] });
  const location = h.create();
  await h.newWorktree(location);
  await h.send(location); await h.settle(location);
  await until(() => h.workspace(location).branch === 'feature/agent-made', 'the branch to be adopted');
});
