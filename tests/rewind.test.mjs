import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionRewinds } from '../dist/backend/sessions/rewinds.js';
import { worktreeFixture, bashCall, message, until, git } from './helpers/worktreeFixture.mjs';

const opts = { timeout: 30000, skip: process.platform === 'win32' };
const lastUser = body => JSON.stringify(body.input.filter(item => item.role === 'user').at(-1));
const users = (h, location) => h.sessions.history(location, null).entries.filter(entry => entry.kind === 'user');

test('editing from a message rewinds the conversation to before it and gives the message back', opts, async t => {
  const h = await worktreeFixture(t, { respond: body => [message(`Answer to ${JSON.parse(lastUser(body)).content[0].text}`)] });
  const rewinds = new SessionRewinds(h.sessions, h.worktrees);
  const location = h.create();
  await h.send(location, 'First'); await h.settle(location);
  await h.send(location, 'Second'); await h.settle(location);
  const second = users(h, location).at(-1);
  const result = await rewinds.rewind(location, h.sessions.read(location).revision, second.id, false);
  assert.equal(result.text, 'Second');
  assert.deepEqual(result.images, []);
  assert.deepEqual(users(h, location).map(entry => entry.text), ['First']);
  assert.deepEqual(h.sessions.history(location, null).entries.filter(entry => entry.kind !== 'settings').map(entry => entry.kind), ['user', 'assistant']);
  await h.send(location, 'Second, reworded'); await h.settle(location);
  assert.ok(!JSON.stringify(h.requests.at(-1).input).includes('"Second"'), 'the rewound message is no longer part of the conversation');
  assert.deepEqual(users(h, location).map(entry => entry.text), ['First', 'Second, reworded']);
  await assert.rejects(rewinds.rewind(location, h.sessions.read(location).revision, second.id, false), { message: 'The message to rewind is no longer available.' });
  const first = users(h, location)[0];
  await assert.rejects(rewinds.rewind(location, h.sessions.read(location).revision, first.id, true), { message: /shares the project directory/ }, 'only a worktree thread can restore files');
  await rewinds.rewind(location, h.sessions.read(location).revision, first.id, false);
  assert.deepEqual(h.sessions.history(location, null).entries, [], 'rewinding the first message empties the conversation');
});

test('in a worktree, files can go back to how they were before the message', opts, async t => {
  let step = 0;
  const h = await worktreeFixture(t, { namer: { branch: () => new Promise(() => {}) }, respond: (body, n) => {
    const text = JSON.parse(lastUser(body)).content?.[0]?.text ?? '';
    if (n % 2 === 1) return [bashCall(text === 'One' ? 'printf one > a.txt' : 'printf two > a.txt; printf new > b.txt; rm README.md', `call-${++step}`)];
    return [message('Done.')];
  } });
  const rewinds = new SessionRewinds(h.sessions, h.worktrees);
  const location = h.create();
  await h.newWorktree(location);
  await h.send(location, 'One'); await h.settle(location);
  const path = h.workspace(location).worktreePath;
  await h.send(location, 'Two'); await h.settle(location);
  assert.equal(readFileSync(join(path, 'a.txt'), 'utf8'), 'two');
  const [one, two] = users(h, location);
  await rewinds.rewind(location, h.sessions.read(location).revision, two.id, true);
  assert.equal(readFileSync(join(path, 'a.txt'), 'utf8'), 'one', 'changed files are restored');
  assert.equal(existsSync(join(path, 'b.txt')), false, 'files added since are removed');
  assert.ok(existsSync(join(path, 'README.md')), 'deleted files come back');
  await rewinds.rewind(location, h.sessions.read(location).revision, one.id, true);
  assert.equal(existsSync(join(path, 'a.txt')), false, 'back to before the first message');
  await until(async () => (await git(h.project, ['for-each-ref', `refs/flame/checkpoints/${location.sessionId}/`])) === '', 'checkpoints of rewound responses to be dropped');
  const other = h.create();
  await h.configure(other, { mode: 'worktree', baseBranch: null, startFromOrigin: false, branch: null, worktreePath: path });
  await h.send(location, 'One'); await h.settle(location);
  await assert.rejects(rewinds.rewind(location, h.sessions.read(location).revision, users(h, location)[0].id, true), { message: /isolated worktree/ });
  h.sessions.remove(other, h.sessions.read(other).revision);
  h.sessions.remove(location, h.sessions.read(location).revision);
  await until(async () => (await git(h.project, ['for-each-ref', 'refs/flame/checkpoints/'])) === '', 'a deleted session\'s checkpoints to go');
});

test('a rewind waits for the agent to finish', opts, async t => {
  const h = await worktreeFixture(t, { respond: async (_body, n, signal) => {
    if (n === 2) await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return [message('Done.')];
  } });
  const rewinds = new SessionRewinds(h.sessions, h.worktrees);
  const location = h.create();
  await h.send(location, 'First'); await h.settle(location);
  const id = await h.send(location, 'Second');
  await until(() => h.requests.length === 2, 'the second request');
  await assert.rejects(rewinds.rewind(location, h.sessions.read(location).revision, users(h, location)[0].id, false), { message: /Stop the active response/ });
  h.turns.stop(location, id); await h.settle(location);
});
