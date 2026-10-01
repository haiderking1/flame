import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { worktreeFixture, bashCall, message, until } from './helpers/worktreeFixture.mjs';

const opts = { timeout: 30000, skip: process.platform === 'win32' };
const userTexts = h => location => h.sessions.history(location, null).entries.filter(entry => entry.kind === 'user').map(entry => entry.text);
const lastUser = body => { const users = body.input.filter(item => item.role === 'user'); return JSON.stringify(users.at(-1)); };

test('a follow-up sent while the agent runs a tool takes over at that tool step as the next message', opts, async t => {
  const h = await worktreeFixture(t, { respond: async (body, n) => {
    if (n === 1) return [bashCall('sleep 0.4; printf one')];
    if (n === 2) { assert.match(lastUser(body), /Also check the tests/); assert.ok(body.input.some(item => item.type === 'function_call_output'), 'the first run\'s tool result is kept'); return [message('Checked the tests too.')]; }
    return [message('unexpected')];
  } });
  const location = h.create();
  const first = await h.send(location, 'Run the build');
  await until(() => h.requests.length === 1, 'the first request');
  const input = { ...location, revision: h.sessions.read(location).revision, requestId: crypto.randomUUID(), text: 'Also check the tests', accountKey: 'test' };
  await h.turns.start(input);
  assert.deepEqual(h.turns.snapshot(location).queued, [input.requestId], 'the follow-up waits for the next tool step');
  await h.turns.start(input);
  assert.deepEqual(h.turns.snapshot(location).queued, [input.requestId], 'resending the same request is harmless');
  await until(() => { const turn = h.turns.snapshot(location); return turn?.id === input.requestId && turn.status === 'completed'; }, 'the follow-up to be answered');
  assert.equal(h.sessions.turns(location, store => store.snapshot(first)).status, 'completed', 'the first run ends at the tool step');
  assert.deepEqual(userTexts(h)(location), ['Run the build', 'Also check the tests']);
  assert.equal(h.requests.length, 2, 'the model was not asked again in the first run');
  const kinds = h.sessions.history(location, null).entries.map(entry => entry.kind).filter(kind => kind !== 'settings');
  assert.deepEqual(kinds, ['user', 'assistant', 'user', 'assistant'], 'the work, then the follow-up, then its answer');
});

test('a follow-up sent during a final answer goes next, and several go one per step in order', opts, async t => {
  let answer; const answering = new Promise(resolve => { answer = resolve; });
  const h = await worktreeFixture(t, { respond: async (body, n) => {
    if (n === 1) { await answering; return [message('First answer.')]; }
    return [message(`Answer to ${JSON.parse(lastUser(body)).content[0].text}`)];
  } });
  const location = h.create();
  await h.send(location, 'First');
  await until(() => h.requests.length === 1, 'the first request');
  const a = await h.send(location, 'Second'), b = await h.send(location, 'Third');
  assert.deepEqual(h.turns.snapshot(location).queued, [a, b]);
  answer();
  await until(() => { const turn = h.turns.snapshot(location); return turn?.id === b && turn.status === 'completed'; }, 'both follow-ups');
  assert.deepEqual(userTexts(h)(location), ['First', 'Second', 'Third']);
  assert.equal(h.requests.length, 3);
});

test('stopping the run gives waiting follow-ups back instead of sending them', opts, async t => {
  const h = await worktreeFixture(t, { respond: async (_body, n, signal) => {
    if (n === 1) { await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
    return [message('unexpected')];
  } });
  const location = h.create();
  const first = await h.send(location, 'Long task');
  await until(() => h.requests.length === 1, 'the first request');
  const followUp = await h.send(location, 'Never mind, do this');
  h.turns.stop(location, first);
  const turn = await h.settle(location);
  assert.equal(turn.status, 'cancelled');
  assert.deepEqual(turn.returned, [followUp], 'the composer takes it back');
  assert.equal(turn.queued, undefined);
  await delay(50);
  assert.deepEqual(userTexts(h)(location), ['Long task'], 'nothing was sent');
  assert.equal(h.requests.length, 1);
});

test('every session\'s latest run is announced when it starts and ends, and forgotten when the session is deleted', opts, async t => {
  const h = await worktreeFixture(t, { respond: () => [message('Done.')] });
  const location = h.create();
  const seen = []; h.turns.on('states', () => seen.push(h.turns.states().map(state => state.status)));
  const id = await h.send(location, 'Hello');
  await h.settle(location);
  await until(() => h.turns.states().some(state => state.turnId === id && state.status === 'completed'), 'the finished state');
  const [state] = h.turns.states();
  assert.deepEqual({ ...state, startedAt: typeof state.startedAt, finishedAt: typeof state.finishedAt },
    { ...location, turnId: id, status: 'completed', operation: 'response', startedAt: 'number', finishedAt: 'number' });
  assert.ok(seen.some(statuses => statuses.includes('running')), 'the start was announced');
  h.sessions.remove(location, h.sessions.read(location).revision);
  assert.deepEqual(h.turns.states(), []);
});
