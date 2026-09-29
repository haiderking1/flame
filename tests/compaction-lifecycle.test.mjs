import assert from 'node:assert/strict';
import test from 'node:test';
import { harness, message, until } from './helpers/compaction.mjs';

const opts = { timeout: 15000, skip: process.platform === 'win32' };
const blocked = (_body, signal) => new Promise((resolve, reject) => {
  const abort = () => reject(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
});

test('shutdown during manual compaction survives restart without committing or restarting the request', opts, async t => {
  const h = harness(t, blocked);
  h.seed(); const before = h.context();
  await h.compact(); await until(() => h.requests.length > 0);
  const calls = h.requests.length;
  await h.restart();
  assert.equal(h.turns.snapshot(h.location).status, 'interrupted');
  assert.equal(h.checkpoints().length, 0);
  assert.equal(h.requests.length, calls);
  assert.deepEqual(h.context(), before);
});

test('manual compaction rejects a concurrent active response and cannot steal its submission identifier', opts, async t => {
  const h = harness(t, blocked);
  h.seed(100);
  await h.start('Continue'); await until(() => h.requests.length > 0);
  const response = h.turns.snapshot(h.location);
  await assert.rejects(h.compact(), /Stop the active response/);
  await assert.rejects(h.compact({ requestId: response.id }), /belongs to a response/);
  assert.equal(h.requests.length, 1);
  assert.equal(h.turns.snapshot(h.location).id, response.id);
  h.turns.stop(h.location, response.id); await h.done();
});

test('empty and oversized model summaries cannot replace history', opts, async t => {
  for (const answer of ['', 'x'.repeat(64000)]) {
    const h = harness(t, () => [message(answer)]);
    h.seed(); const before = h.context();
    await h.compact();
    assert.equal((await h.done()).status, 'failed');
    assert.equal(h.checkpoints().length, 0);
    assert.deepEqual(h.context(), before);
  }
});
