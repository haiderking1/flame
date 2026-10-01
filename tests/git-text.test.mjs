import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSourceControl, remoteRepository, changeRequestTerminology } from '../dist/contracts/source-control.js';
import { sanitizeFeatureBranchName, uniqueBranchName } from '../dist/backend/git/branch-names.js';
import { parseReply, commitText, commitSubject, CodexGitWriter } from '../dist/backend/git/writer/writer.js';
import { commitPrompt, changeRequestPrompt } from '../dist/backend/git/writer/prompts.js';
import { completionToast } from '../dist/backend/git/actions/toast.js';
import { InferenceFailure } from '../dist/backend/turns/sse.js';

test('hosting providers are detected from remote URLs and named the way the host does', () => {
  assert.deepEqual(detectSourceControl('git@github.com:acme/app.git'), { kind: 'github', name: 'GitHub', host: 'github.com' });
  assert.equal(detectSourceControl('https://gitlab.example.com/group/sub/app.git').kind, 'gitlab');
  assert.equal(detectSourceControl('ssh://git@codeberg.org/acme/app.git').kind, 'forgejo');
  assert.equal(detectSourceControl('https://dev.azure.com/org/p/_git/app').kind, 'azure-devops');
  assert.equal(detectSourceControl('https://bitbucket.org/acme/app.git').kind, 'bitbucket');
  assert.equal(detectSourceControl('https://git.example.com/acme/app.git').kind, 'unknown');
  assert.equal(detectSourceControl('/srv/git/app.git'), null);
  assert.equal(remoteRepository('git@github.com:acme/app.git'), 'acme/app'); assert.equal(remoteRepository('https://gitlab.com/g/s/app'), 'g/s/app');
  assert.deepEqual(changeRequestTerminology('gitlab'), { shortLabel: 'MR', singular: 'merge request' });
  assert.deepEqual(changeRequestTerminology('github'), { shortLabel: 'PR', singular: 'pull request' });
});

test('feature branch names are safe, prefixed and unique', () => {
  assert.equal(sanitizeFeatureBranchName('Fix: the "Login" redirect.'), 'feature/fix-the-login-redirect');
  assert.equal(sanitizeFeatureBranchName('feature/Already Prefixed'), 'feature/already-prefixed');
  assert.equal(sanitizeFeatureBranchName('   ...  '), 'feature/update');
  assert.equal(sanitizeFeatureBranchName('a'.repeat(100)).length, 'feature/'.length + 64);
  assert.equal(uniqueBranchName(['feature/x', 'Feature/X-2'], 'feature/x'), 'feature/x-3');
});

test('model replies are parsed leniently and normalized to commit conventions', () => {
  assert.deepEqual(parseReply('```json\n{"subject":"Add x.","body":"- y"}\n```'), { subject: 'Add x.', body: '- y' });
  assert.throws(() => parseReply('no json here'), { code: 'COMMAND' });
  assert.deepEqual(commitText({ subject: 'Add parser...\nsecond line', body: ' - quotes ', branch: 'Parser Work' }, true), { subject: 'Add parser', body: '- quotes', branch: 'feature/parser-work' });
  assert.equal(commitSubject(''), 'Update project files'); assert.equal(commitSubject('x'.repeat(90)).length, 72);
  const prompt = commitPrompt({ branch: null, summary: 'M a', patch: 'p'.repeat(50_000), includeBranch: true, conventions: 'Use sentence case.' });
  assert.match(prompt, /keys: subject, body, branch\./); assert.match(prompt, /Branch: \(detached\)/); assert.match(prompt, /\[truncated\]/); assert.match(prompt, /Additional instructions:\nUse sentence case\./);
  assert.match(changeRequestPrompt({ base: 'main', head: 'f', commits: '', stat: '', patch: '', template: null, conventions: '', singular: 'merge request' }), /'## Summary' and '## Testing'/);
});

test('the writer calls the selected model without tools and turns failures into Git errors', async () => {
  const requests = [], auth = { usageSession: () => ({ key: 'k', accountId: 'acct', access: 'token', epoch: 1 }), refresh: async () => {} };
  const models = { state: { selection: { modelId: 'default-model', effort: 'high', serviceTier: 'priority' } }, validateSelection: (_key, selection) => selection };
  const writer = new CodexGitWriter(auth, models, { run: async request => { requests.push(request); return { text: '{"subject":"Add tests","body":""}', output: [] }; } });
  assert.deepEqual(await writer.commit('prompt', { modelId: 'chosen', effort: null, serviceTier: 'default' }, false, new AbortController().signal), { subject: 'Add tests', body: '', branch: null });
  assert.equal(requests[0].settings.modelId, 'chosen'); assert.equal(requests[0].tools, false); assert.equal(requests[0].bashTools, false); assert.match(requests[0].instructionsOverride, /JSON/);
  await writer.commit('prompt', null, false, new AbortController().signal); assert.equal(requests[1].settings.modelId, 'default-model'); assert.equal(requests[1].settings.serviceTier, 'default');
  const catalogOnly = new CodexGitWriter(auth, { state: { selection: null, catalog: { models: [{ id: 'first-model' }] } }, validateSelection: (_key, selection) => selection }, { run: async request => { requests.push(request); return { text: '{"subject":"x","body":""}', output: [] }; } });
  await catalogOnly.commit('p', null, false, new AbortController().signal); assert.equal(requests.at(-1).settings.modelId, 'first-model', 'any available model is used when none is selected');
  const signedOut = new CodexGitWriter({ usageSession: () => null, refresh: async () => {} }, models, { run: async () => assert.fail('no request') });
  await assert.rejects(signedOut.commit('p', null, false, new AbortController().signal), { code: 'INVALID', message: /Sign in to OpenAI/ });
  const limited = new CodexGitWriter(auth, models, { run: async () => { throw new InferenceFailure('OpenAI rate-limited this response.'); } });
  await assert.rejects(limited.commit('p', null, false, new AbortController().signal), { code: 'COMMAND', message: 'Text generation failed: OpenAI rate-limited this response.' });
  const gone = new CodexGitWriter(auth, { ...models, validateSelection: () => { throw new Error('gone'); } }, { run: async () => assert.fail('no request') });
  await assert.rejects(gone.commit('p', null, false, new AbortController().signal), { message: /no longer available/ });
});

test('completion toasts summarize the result and offer the next step', () => {
  const none = { branch: null, commit: null, push: null, pr: null, pull: null, publish: null };
  const commit = { sha: 'abcdef1234567', subject: 'Add search' }, push = { branch: 'feature/a', upstream: 'origin/feature/a', setUpstream: true, skipped: false };
  const github = { kind: 'github', isDefaultBranch: false, openPrUrl: null };
  assert.deepEqual(completionToast('commit', { ...none, commit }, github), { title: 'Committed abcdef1', description: 'Add search', cta: { kind: 'run_action', label: 'Push', action: 'push' } });
  assert.deepEqual(completionToast('commit_push', { ...none, commit, push }, github).cta, { kind: 'run_action', label: 'Create PR', action: 'create_pr' });
  assert.equal(completionToast('commit_push', { ...none, commit, push }, github).title, 'Pushed abcdef1 to origin/feature/a');
  assert.deepEqual(completionToast('push', { ...none, push }, { ...github, openPrUrl: 'https://x/pull/1' }).cta, { kind: 'open_pr', label: 'View PR', url: 'https://x/pull/1' });
  assert.deepEqual(completionToast('push', { ...none, push }, { ...github, isDefaultBranch: true }).cta, { kind: 'none' });
  assert.deepEqual(completionToast('push', { ...none, push }, { ...github, kind: 'unknown' }).cta, { kind: 'none' });
  const pr = { status: 'created', number: 9, url: 'https://gitlab.com/a/b/-/merge_requests/9', title: 'x'.repeat(80), baseBranch: 'main', headBranch: 'f' };
  const created = completionToast('create_pr', { ...none, pr }, { ...github, kind: 'gitlab' });
  assert.equal(created.title, 'Created MR #9'); assert.equal(created.description.length, 72); assert.ok(created.description.endsWith('...')); assert.equal(created.cta.label, 'View MR');
});
