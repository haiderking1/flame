import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('./helpers/contracts-alias.mjs', import.meta.url);
const logic = await import('../src/renderer/components/notifications/notificationLogic.ts');

const p = '11111111-1111-4111-8111-111111111111', a = '22222222-2222-4222-8222-222222222222', b = '33333333-3333-4333-8333-333333333333';
const t1 = '44444444-4444-4444-8444-444444444444', t2 = '55555555-5555-4555-8555-555555555555';
const state = (sessionId, turnId, status, extra = {}) => ({ projectId: p, sessionId, turnId, status, operation: 'response', startedAt: 1, finishedAt: status === 'running' ? null : 5, ...extra });
const map = states => new Map(states.map(item => [logic.runKey(item), item]));

test('threads alert once when a run finishes or fails, never for old results, stops or compaction', () => {
  assert.deepEqual(logic.threadEvents(null, [state(a, t1, 'completed')]), [], 'the first snapshot never replays');
  const running = map([state(a, t1, 'running'), state(b, t1, 'running')]);
  assert.deepEqual(logic.threadEvents(running, [state(a, t1, 'completed'), state(b, t1, 'failed')]).map(event => [event.kind, event.state.sessionId]), [['completion', a], ['failed', b]]);
  assert.deepEqual(logic.threadEvents(running, [state(a, t1, 'interrupted')]).map(event => event.kind), ['failed']);
  assert.deepEqual(logic.threadEvents(running, [state(a, t1, 'cancelled')]), [], 'a stopped run is not an alert');
  assert.deepEqual(logic.threadEvents(map([state(a, t1, 'running', { operation: 'compaction' })]), [state(a, t1, 'completed', { operation: 'compaction' })]), []);
  assert.deepEqual(logic.threadEvents(map([state(a, t1, 'completed')]), [state(a, t1, 'completed')]), [], 'an unchanged result does not alert again');
  assert.deepEqual(logic.threadEvents(map([state(a, t1, 'completed')]), [state(a, t2, 'completed')]).length, 1, 'a later run that finished between snapshots alerts');
  assert.deepEqual(logic.threadEvents(map([]), [state(a, t1, 'completed')]), [], 'a thread first seen already finished does not alert');
});

test('notification modes, unseen completions and the badge follow T3 Code', () => {
  assert.equal(logic.includesNotifications('notifications-and-sound'), true);
  assert.equal(logic.includesNotifications('sound'), false);
  assert.equal(logic.includesSound('sound'), true);
  assert.equal(logic.includesSound('off'), false);
  assert.equal(logic.NOTIFICATION_MODE_LABELS['notifications-and-sound'], 'Notifications with sound');
  assert.equal(logic.eventTitle('completion'), 'Thread completed');
  assert.equal(logic.eventTitle('failed'), 'Thread failed');
  assert.equal(logic.hasUnseenCompletion(state(a, t1, 'completed'), 4), true);
  assert.equal(logic.hasUnseenCompletion(state(a, t1, 'completed'), 5), false);
  assert.equal(logic.hasUnseenCompletion(state(a, t1, 'completed'), undefined), false, 'a thread never visited counts as read');
  assert.equal(logic.hasUnseenCompletion(state(a, t1, 'failed'), 1), false);
  assert.equal(logic.badgeText(3), '3');
  assert.equal(logic.badgeText(12), '9+');
});
