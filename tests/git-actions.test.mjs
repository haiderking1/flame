import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { clearIdentityCache } from '../dist/backend/git/identity.js';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { gitCommand } from '../dist/backend/git/command.js';
import { gitFixture, fakeWriter } from './helpers/gitFixture.mjs';
import { fakeGitHub } from './helpers/fakeHosting.mjs';

const GITHUB = 'https://github.com/acme/app.git';
// Every repository with a GitHub-looking remote gets the fake CLI, so no test can reach the real GitHub.
async function published(t, options = {}) {
  const gh = options.gh ?? await fakeGitHub(t);
  const f = await gitFixture(t, options); await f.init(); const bare = await f.remote(GITHUB);
  await writeFile(join(f.cwd, 'README.md'), '# app\n'); await gitCommand(f.cwd, ['add', '.']); await gitCommand(f.cwd, ['commit', '-m', 'Initial commit']);
  await gitCommand(f.cwd, ['push', '-u', 'origin', 'main']); await gitCommand(f.cwd, ['remote', 'set-head', 'origin', 'main']);
  return { ...f, bare, gh };
}

test('an empty message asks the model, with the staged diff, recent subjects and AGENTS.md as context', async t => {
  const writer = fakeWriter({ subject: 'Add the parser', body: '- handles quotes' });
  const f = await gitFixture(t, { writer }); await f.init();
  await writeFile(join(f.cwd, 'AGENTS.md'), 'Write subjects in sentence case.\n'); await gitCommand(f.cwd, ['add', '.']); await gitCommand(f.cwd, ['commit', '-m', 'Earlier style example']);
  await writeFile(join(f.cwd, 'parser.ts'), 'export const parse = (s: string) => s;\n');
  const done = await f.run('commit', { message: '', expectedBranch: 'main' });
  assert.equal(done.state, 'completed'); assert.equal(done.result.commit.subject, 'Add the parser');
  assert.equal((await gitCommand(f.cwd, ['log', '-1', '--format=%B'])).stdout.toString().trim(), 'Add the parser\n\n- handles quotes');
  const [prompt] = writer.prompts;
  assert.match(prompt, /Return a JSON object with keys: subject, body\./); assert.match(prompt, /A\s+parser\.ts/); assert.match(prompt, /export const parse/);
  assert.match(prompt, /Earlier style example/); assert.match(prompt, /Write subjects in sentence case/);
});

test('a generation failure fails the action without committing', async t => {
  const f = await gitFixture(t, { writer: fakeWriter({ fail: 'Text generation failed: OpenAI rate-limited this response.' }) }); await f.init();
  await writeFile(join(f.cwd, 'a.ts'), 'a\n');
  const failed = await f.run('commit', { message: '', expectedBranch: 'main' });
  assert.equal(failed.state, 'failed'); assert.match(failed.detail, /rate-limited/); assert.equal((await gitCommand(f.cwd, ['rev-list', '--count', 'HEAD'], { allowed: [0, 128] })).code, 128);
});

test('commit on a new branch names it from the model and leaves the default branch untouched', async t => {
  const f = await published(t, { writer: fakeWriter({ subject: 'Add search', branch: 'search box' }) });
  await gitCommand(f.cwd, ['branch', 'feature/search-box']);
  await writeFile(join(f.cwd, 'search.ts'), 'search\n');
  const done = await f.run('commit', { message: '', featureBranch: true, expectedBranch: 'main' });
  assert.equal(done.state, 'completed', done.detail ?? ''); assert.equal(done.result.branch, 'feature/search-box-2', 'collisions get a numeric suffix');
  assert.equal((await gitCommand(f.cwd, ['branch', '--show-current'])).stdout.toString().trim(), 'feature/search-box-2');
  assert.equal(await f.count('main'), 1, 'main did not move');
  const custom = await gitFixture(t); await custom.init(); await writeFile(join(custom.cwd, 'x'), 'x');
  const named = await custom.run('commit', { message: 'Fix: the "login" redirect.', featureBranch: true, expectedBranch: 'main' });
  assert.equal(named.result.branch, 'feature/fix-the-login-redirect', 'a written message names the branch');
  const clean = await custom.run('commit', { message: 'Nothing', featureBranch: true, expectedBranch: named.result.branch });
  assert.equal(clean.state, 'failed'); assert.match(clean.detail, /no changes to commit/);
});

test('status reports ahead/behind, the default branch, the provider and the open pull request', async t => {
  const gh = await fakeGitHub(t);
  const f = await published(t, { gh });
  let status = await f.service.status(f.projectId);
  assert.deepEqual([status.branch, status.upstream, status.ahead, status.behind, status.isDefaultBranch, status.defaultBranch, status.hasPrimaryRemote], ['main', 'origin/main', 0, 0, true, 'main', true]);
  assert.deepEqual(status.provider, { kind: 'github', name: 'GitHub', host: 'github.com' });
  await gitCommand(f.cwd, ['switch', '-c', 'feature/x']); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'Work']);
  status = await f.service.status(f.projectId);
  assert.deepEqual([status.upstream, status.ahead, status.aheadOfDefault, status.isDefaultBranch], [null, 1, 1, false], 'without an upstream, ahead counts commits not on main');
  await gitCommand(f.cwd, ['push', '-u', 'origin', 'feature/x']);
  await gh.setPrs([{ number: 7, title: 'Work', url: 'https://github.com/acme/app/pull/7', baseRefName: 'main', headRefName: 'feature/x', state: 'OPEN', updatedAt: '2026-01-01T00:00:00Z', headRepositoryOwner: { login: 'acme' } }]);
  f.changed.length = 0;
  let pr = (await f.service.status(f.projectId)).pr;
  for (let i = 0; i < 300 && !pr; i++) { await delay(10); pr = (await f.service.status(f.projectId)).pr; }
  assert.ok(f.changed.includes(f.projectId), 'clients are told to recheck when the lookup finds something new');
  assert.deepEqual(pr, { number: 7, title: 'Work', url: 'https://github.com/acme/app/pull/7', baseBranch: 'main', headBranch: 'feature/x', state: 'open' });
  const other = await gitFixture(t); await other.init(); await other.remote();
  await gitCommand(other.cwd, ['commit', '--allow-empty', '-m', 'one']);
  const local = await other.service.status(other.projectId);
  assert.deepEqual([local.provider?.kind ?? null, local.ahead, local.hasPrimaryRemote], [null, 1, true], 'a local-path remote has no host; a never-pushed default branch counts every commit as unpushed');
});

test('a background fetch notices remote commits and Pull fast-forwards them', async t => {
  const f = await published(t);
  const peer = join(f.root, 'peer'); await gitCommand(f.root, ['clone', '--quiet', f.bare, peer]);
  for (const [key, value] of [['user.name', 'Peer'], ['user.email', 'peer@example.invalid'], ['commit.gpgSign', 'false']]) await gitCommand(peer, ['config', key, value]);
  await gitCommand(peer, ['commit', '--allow-empty', '-m', 'From a teammate']); await gitCommand(peer, ['push', 'origin', 'main']);
  await f.service.status(f.projectId);
  for (let i = 0; i < 300 && !f.changed.length; i++) await delay(10);
  const behind = await f.service.status(f.projectId); assert.equal(behind.behind, 1, 'tracking refs were fetched in the background');
  const pulled = await f.run('pull', { message: '', expectedBranch: 'main' });
  assert.equal(pulled.state, 'completed'); assert.deepEqual(pulled.result.pull, { updated: true, branch: 'main', upstream: 'origin/main' }); assert.equal(pulled.result.toast.title, 'Pulled');
  assert.equal((await f.run('pull', { message: '', expectedBranch: 'main' })).result.toast.title, 'Already up to date');
  await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'Local']); await gitCommand(peer, ['commit', '--allow-empty', '-m', 'Remote']); await gitCommand(peer, ['push', 'origin', 'main']);
  await gitCommand(f.cwd, ['fetch', 'origin']);
  const diverged = await f.run('pull', { message: '', expectedBranch: 'main' }); assert.equal(diverged.state, 'failed', 'pull never merges or rebases');
});

test('commit, push & PR creates the pull request with generated text and offers to view it', async t => {
  const gh = await fakeGitHub(t);
  const f = await published(t, { gh, writer: fakeWriter({ subject: 'Add search', title: 'Add search box', prBody: '## Summary\n- search\n\n## Testing\n- Not run' }) });
  await mkdir(join(f.cwd, '.github')); await writeFile(join(f.cwd, '.github', 'pull_request_template.md'), '## What\n<!-- describe -->\n');
  await gitCommand(f.cwd, ['add', '.']); await gitCommand(f.cwd, ['commit', '-m', 'Add template']); await gitCommand(f.cwd, ['push']);
  await gitCommand(f.cwd, ['switch', '-c', 'feature/search']); await writeFile(join(f.cwd, 'search.ts'), 'search\n');
  const done = await f.run('commit_push_pr', { message: '', expectedBranch: 'feature/search' });
  assert.equal(done.state, 'completed', done.detail ?? '');
  assert.deepEqual(done.phases, ['commit', 'push', 'pr']);
  assert.deepEqual(done.result.pr, { status: 'created', number: 12, url: 'https://github.com/acme/app/pull/12', title: 'Add search box', baseBranch: 'main', headBranch: 'feature/search' });
  assert.equal(done.result.toast.title, 'Created PR #12'); assert.deepEqual(done.result.toast.cta, { kind: 'open_pr', label: 'View PR', url: 'https://github.com/acme/app/pull/12' });
  const create = (await gh.calls()).find(args => args[0] === 'pr' && args[1] === 'create');
  assert.deepEqual(create.slice(0, 8), ['pr', 'create', '--base', 'main', '--head', 'feature/search', '--title', 'Add search box']);
  assert.match((await gh.prs())[0].body, /## Summary/);
  assert.match(f.writer.prompts.at(-1), /Repository pull request template:\n## What/, 'the GitHub template on the base branch shapes the body');
  const again = await f.run('create_pr', { message: '', expectedBranch: 'feature/search' });
  assert.equal(again.result.pr.status, 'opened_existing'); assert.equal(again.result.toast.title, 'Opened PR #12');
});

test('pushing a feature branch suggests creating a pull request; pushing on the default branch does not', async t => {
  const f = await published(t);
  await gitCommand(f.cwd, ['switch', '-c', 'feature/a']); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'A']);
  const pushed = await f.run('push', { message: '', expectedBranch: 'feature/a' });
  assert.equal(pushed.result.push.upstream, 'origin/feature/a'); assert.deepEqual(pushed.result.toast.cta, { kind: 'run_action', label: 'Create PR', action: 'create_pr' });
  await gitCommand(f.cwd, ['switch', 'main']); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'Main']);
  assert.deepEqual((await f.run('push', { message: '', expectedBranch: 'main' })).result.toast.cta, { kind: 'none' });
});

test('a branch cut from main pushes to its own name and remembers main as the merge base', async t => {
  const f = await published(t);
  await gitCommand(f.cwd, ['switch', '-c', 'topic', '--track', 'origin/main']); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'Topic']);
  const pushed = await f.run('push', { message: '', expectedBranch: 'topic' });
  assert.equal(pushed.state, 'completed'); assert.equal(pushed.result.push.upstream, 'origin/topic');
  assert.equal(await f.count('origin/main'), 1, 'main on the remote did not move');
  assert.equal((await gitCommand(f.cwd, ['config', '--get', 'branch.topic.gh-merge-base'])).stdout.toString().trim(), 'main');
});

test('pushing from the default branch onto a feature branch moves local commits to a new branch', async t => {
  const f = await published(t);
  await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'Add dark mode']);
  const done = await f.run('create_pr', { message: '', featureBranch: true, expectedBranch: 'main' });
  assert.equal(done.state, 'completed', done.detail ?? ''); assert.equal(done.result.branch, 'feature/add-dark-mode');
  assert.equal(done.result.push.upstream, 'origin/feature/add-dark-mode'); assert.equal(done.result.pr.baseBranch, 'main');
});

test('publishing creates the repository, adds the remote and pushes the current branch', async t => {
  const gh = await fakeGitHub(t, { login: 'octo' });
  const f = await gitFixture(t); await f.init(); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'First']);
  const bare = join(f.root, 'published.git'); await mkdir(bare); await gitCommand(bare, ['init', '--bare', '--initial-branch=main']);
  await gitCommand(f.cwd, ['config', `url.${bare}.insteadOf`, 'https://github.com/octo/new-app.git']);
  const hosting = await f.service.hosting(); assert.deepEqual(hosting.find(item => item.kind === 'github'), { kind: 'github', name: 'GitHub', host: 'github.com', ready: true, account: 'octo', hint: null, protocol: 'https' });
  const done = await f.run('publish', { message: '', publish: { provider: 'github', repository: 'octo/new-app', visibility: 'private', remote: 'origin', protocol: 'https' } });
  assert.equal(done.state, 'completed', done.detail ?? '');
  assert.deepEqual(done.result.publish, { repository: 'octo/new-app', url: 'https://github.com/octo/new-app', remote: 'origin', pushed: true, branch: 'main' });
  assert.equal(done.result.toast.title, 'Repository published');
  assert.deepEqual((await gh.calls()).find(args => args[0] === 'repo'), ['repo', 'create', 'octo/new-app', '--private']);
  assert.equal((await f.service.status(f.projectId)).upstream, 'origin/main');
  const unready = await gitFixture(t); await unready.init();
  await fakeGitHub(t, { authenticated: false });
  const failed = await unready.run('publish', { message: '', publish: { provider: 'github', repository: 'octo/other', visibility: 'public', remote: 'origin', protocol: 'ssh' } });
  assert.equal(failed.state, 'failed'); assert.match(failed.detail, /not authenticated.*gh auth login/);
});

test('change requests need a supported host and a pushed branch', async t => {
  const f = await gitFixture(t); await f.init(); await f.remote(); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'One']);
  const unsupported = await f.run('create_pr', { message: '', expectedBranch: 'main' });
  assert.equal(unsupported.state, 'failed'); assert.match(unsupported.detail, /GitHub or GitLab/);
  await writeFile(join(f.cwd, 'dirty'), 'x');
  const dirty = await f.run('create_pr', { message: '', expectedBranch: 'main' }); assert.match(dirty.detail, /Commit local changes/);
});

/** A repository where Git has no author identity: no global config and no guessing from the host name. */
async function anonymous(t, gh) {
  const home = await mkdtemp(join(tmpdir(), 'flame-home-')), saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, '.config'); clearIdentityCache();
  t.after(async () => { Object.assign(process.env, saved); if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; clearIdentityCache(); await rm(home, { recursive: true, force: true }); });
  const f = await gitFixture(t); await gitCommand(f.cwd, ['init', '--initial-branch=main']);
  await gitCommand(f.cwd, ['config', 'user.useConfigOnly', 'true']); await gitCommand(f.cwd, ['config', 'commit.gpgSign', 'false']);
  return f;
}
test('without a Git identity, commits are authored as the signed-in GitHub account without changing Git config', async t => {
  await fakeGitHub(t);
  const f = await anonymous(t);
  await writeFile(join(f.cwd, 'a.ts'), 'a\n');
  const done = await f.run('commit', { expectedBranch: 'main' });
  assert.equal(done.state, 'completed', done.detail ?? '');
  assert.equal((await gitCommand(f.cwd, ['log', '-1', '--format=%an <%ae>|%cn <%ce>'])).stdout.toString().trim(), 'Octo Cat <42+octo@users.noreply.github.com>|Octo Cat <42+octo@users.noreply.github.com>');
  assert.equal((await gitCommand(f.cwd, ['config', '--get', 'user.email'], { allowed: [0, 1] })).code, 1, 'nothing was written to Git config');
});
test('without a Git identity or a signed-in host, the commit stops before staging with setup steps', async t => {
  await fakeGitHub(t, { authenticated: false });
  const f = await anonymous(t);
  await writeFile(join(f.cwd, 'a.ts'), 'a\n');
  const failed = await f.run('commit', { message: '', expectedBranch: 'main' });
  assert.equal(failed.state, 'failed'); assert.match(failed.detail, /doesn't know who you are.*gh auth login.*git config --global user\.name/);
  assert.equal(f.writer.prompts.length, 0, 'no message was generated');
  assert.deepEqual((await f.service.status(f.projectId)).files.map(file => file.index), ['?'], 'nothing was staged');
});

test('an SSH remote this computer cannot use explains how to switch to HTTPS', async t => {
  const f = await gitFixture(t); await f.init(); await gitCommand(f.cwd, ['commit', '--allow-empty', '-m', 'One']);
  await gitCommand(f.cwd, ['remote', 'add', 'origin', 'git@github.com:acme/app.git']);
  // Point SSH at a command that fails the way an unknown host key does, without touching the network.
  await gitCommand(f.cwd, ['config', 'core.sshCommand', 'sh -c "echo Host key verification failed. >&2; exit 255" --']);
  await fakeGitHub(t);
  const failed = await f.run('push', { message: '', expectedBranch: 'main' });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.detail, "This remote uses SSH, which isn't set up on this computer. Switch it to HTTPS with `git remote set-url origin https://github.com/acme/app.git`, then retry.");
});
test('the publish target follows the CLI\'s configured Git protocol', async t => {
  await fakeGitHub(t, { protocol: 'ssh' });
  const f = await gitFixture(t);
  assert.equal((await f.service.hosting()).find(item => item.kind === 'github').protocol, 'ssh');
});
