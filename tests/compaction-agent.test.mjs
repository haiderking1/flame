import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harness, isSummary, summary, message, reason, tool, completed, overflow, until } from './helpers/compaction.mjs';

const opts = { timeout: 15000, skip: process.platform === 'win32' };

test('auto compaction before a new prompt preserves the raw transcript and latest prompt, then survives restart', opts, async t => {
  const h = harness(t, body => isSummary(body) ? [message(summary)] : [reason('new-response'), message('Done')]);
  h.seed(40000); h.seed(40000);
  await h.start('CURRENT_REQUEST_KEEP');
  const done = await h.done();
  assert.equal(done.status, 'completed');
  assert.equal(h.checkpoints().length, 1);
  assert.equal(h.checkpoints()[0].trigger, 'auto');
  const main = h.requests.filter(body => !isSummary(body));
  assert.equal(main.length, 1);
  assert.equal(main[0].input.at(-1).content[0].text, 'CURRENT_REQUEST_KEEP');
  assert.ok(JSON.stringify(main[0].input).includes('Conversation checkpoint'));
  assert.ok(!JSON.stringify(main[0].input).includes('EARLIER_OBJECTIVE'));
  assert.ok(h.sessions.history(h.location, null).entries.some(entry => entry.text?.includes('EARLIER_OBJECTIVE')));
  const before = h.context();
  await h.restart();
  assert.deepEqual(h.context(), before);
  assert.ok(h.context().some(item => item.encrypted_content === 'opaque-new-response'));
});

test('mid-tool compaction preserves completed real Bash and file operations exactly once', opts, async t => {
  let mains = 0;
  const h = harness(t, body => {
    if (isSummary(body)) return [message(summary)];
    mains++;
    if (mains === 1) return completed([reason('first'), tool('bash',
      { command: "printf x >> marker; printf '%20000s' ''", background: false }, 'bash-once')], 3000);
    if (mains === 2) return completed([reason('second'), tool('write',
      { path: 'made.txt', content: 'saved once', expected_sha256: null }, 'write-once')], 18000);
    assert.equal(mains, 3);
    assert.ok(JSON.stringify(body.input).includes('Conversation checkpoint'));
    assert.ok(body.input.some(item => item.encrypted_content === 'opaque-second'));
    assert.ok(body.input.some(item => item.type === 'function_call_output' && item.call_id === 'write-once'));
    assert.ok(JSON.stringify(body.input).includes('Saved file-operation ledger'));
    return [reason('final'), message('Done')];
  });
  await h.start('Run and save the requested file');
  const done = await h.done();
  assert.equal(done.status, 'completed', h.transportErrors[0]?.stack ?? done.message);
  assert.equal(mains, 3);
  assert.equal(readFileSync(join(h.work, 'marker'), 'utf8'), 'x');
  assert.equal(readFileSync(join(h.work, 'made.txt'), 'utf8'), 'saved once');
  assert.equal(h.bash.list(h.location).length, 1);
  assert.equal(h.checkpoints().length, 1);
  const before = h.context();
  await h.restart();
  assert.deepEqual(h.context(), before);
  assert.equal(readFileSync(join(h.work, 'marker'), 'utf8'), 'x');
});

test('manual compaction changes no human history, is idempotent, and repeated checkpoints incorporate earlier summary', opts, async t => {
  const h = harness(t, body => isSummary(body) ? [message(summary)] : [message('Done')]);
  h.seed();
  const requestId = randomUUID(), history = h.sessions.history(h.location, null).entries;
  await h.compact({ requestId });
  assert.equal((await h.done()).status, 'completed');
  assert.deepEqual(h.sessions.history(h.location, null).entries, history);
  assert.equal(h.checkpoints().length, 1);
  const calls = h.requests.length;
  await h.compact({ requestId });
  assert.equal(h.requests.length, calls);
  h.seed();
  await h.compact();
  assert.equal((await h.done()).status, 'completed');
  assert.equal(h.checkpoints().length, 2);
  assert.ok(JSON.stringify(h.requests.slice(calls)).includes('Conversation checkpoint'));
  const context = h.context();
  await h.restart();
  assert.deepEqual(h.context(), context);
});

test('manual compaction rejects stale revisions and irreducible conversation without replacing context', opts, async t => {
  const h = harness(t, () => [message(summary)]);
  h.seed();
  await assert.rejects(h.compact({ revision: 0 }), error => error.code === 'CONFLICT');
  assert.equal(h.requests.length, 0);
  assert.equal(h.checkpoints().length, 0);
  const small = harness(t, () => [message(summary)]);
  small.seed(20);
  const before = small.context();
  await small.compact();
  assert.equal((await small.done()).status, 'failed');
  assert.deepEqual(small.context(), before);
  assert.equal(small.checkpoints().length, 0);
});

test('manual compaction can shrink a short history below the automatic retention budget', opts, async t => {
  const h = harness(t, () => [message('Goal: continue the existing task and preserve approvals.')]);
  h.seed(3000);
  await h.compact();
  const done = await h.done();
  assert.equal(done.status, 'completed', done.message);
  assert.equal(h.checkpoints().length, 1);
  assert.ok(h.checkpoints()[0].tokensAfter < h.checkpoints()[0].tokensBefore);
});

test('recognized HTTP context overflow compacts and retries once while generic failures never replay', opts, async t => {
  let mains = 0;
  const h = harness(t, body => isSummary(body) ? [message(summary)] : ++mains === 1 ? overflow() : [message('Recovered')], 40000);
  h.seed();
  await h.start('Continue');
  assert.equal((await h.done()).status, 'completed');
  assert.equal(mains, 2);
  assert.equal(h.checkpoints()[0].trigger, 'overflow');
  const failing = harness(t, body => isSummary(body) ? [message(summary)] : new Response('{}', { status: 500 }), 40000);
  failing.seed(); await failing.start('Continue');
  assert.equal((await failing.done()).status, 'failed');
  assert.equal(failing.requests.length, 1);
  assert.equal(failing.checkpoints().length, 0);
});

test('second overflow fails after one recovery without exposing provider details or running tools', opts, async t => {
  const h = harness(t, body => isSummary(body) ? [message(summary)] : overflow(), 40000);
  h.seed(); await h.start('Continue');
  const done = await h.done();
  assert.equal(done.status, 'failed');
  assert.equal(h.requests.filter(body => !isSummary(body)).length, 2);
  assert.equal(h.checkpoints().length, 1);
  assert.ok(!done.message.includes('private-provider-details'));
  assert.equal(h.bash.list(h.location).length, 0);
});

test('Stop and account switch cancel active summary without checkpoint commits or model continuation', opts, async t => {
  for (const action of ['stop', 'account']) {
    const h = harness(t, (_body, signal) => new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    }));
    h.seed(); const before = h.context();
    await h.compact();
    await until(() => h.requests.length > 0);
    const snapshot = h.turns.snapshot(h.location);
    assert.equal(snapshot.phase, 'compacting');
    if (action === 'stop') h.turns.stop(h.location, snapshot.id); else h.switchAccount();
    const done = await h.done();
    assert.equal(done.status, 'cancelled');
    assert.equal(h.checkpoints().length, 0);
    if (action === 'stop') assert.deepEqual(h.context(), before);
    assert.ok(h.requests.every(isSummary));
  }
});

test('failed, incomplete, and tool-calling summaries preserve transcript and never execute tool side effects', opts, async t => {
  const failures = [() => new Response('{}', { status: 500 }),
    () => new Response(`data: ${JSON.stringify({ type: 'response.incomplete', response: { status: 'incomplete' } })}\n\n`),
    () => [tool('bash', { command: 'printf unsafe > marker', background: false })]];
  for (const respond of failures) {
    const h = harness(t, respond); h.seed(); const before = h.context();
    await h.compact(); assert.equal((await h.done()).status, 'failed');
    assert.deepEqual(h.context(), before);
    assert.equal(h.checkpoints().length, 0);
    assert.equal(h.bash.list(h.location).length, 0);
    assert.throws(() => readFileSync(join(h.work, 'marker')), /ENOENT/);
  }
});

test('checkpoint persistence failure reports failure and keeps the preceding history', opts, async t => {
  const h = harness(t, () => [message(summary)]); h.seed(); const before = h.context();
  const original = h.sessions.compactions.bind(h.sessions);
  h.sessions.compactions = (location, work) => original(location, store => work(new Proxy(store, { get(target, property) {
    if (property === 'save') return () => { throw new Error('simulated disk full'); };
    const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
  } })));
  await h.compact(); assert.equal((await h.done()).status, 'failed');
  h.sessions.compactions = original;
  assert.equal(h.checkpoints().length, 0);
  assert.deepEqual(h.context(), before);
  assert.equal(h.bash.list(h.location).length, 0);
});
