import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexUsage } from '../dist/backend/usage/service.js';
import { UsageStore } from '../dist/backend/usage/store.js';
import { CodexUsageClient } from '../dist/backend/usage/client.js';
import { parseUsage, parseCredits } from '../dist/backend/usage/payloads.js';

const session = { key: 'account-key', accountId: 'account', access: 'secret', epoch: 1 };
const wireUsage = { rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000, reset_at: 2000000000 }, secondary_window: { used_percent: 65, limit_window_seconds: 604800, reset_at: 2000000000 } }, rate_limit_reset_credits: { available_count: 2 } };
const credit = { id: 'credit-1', title: 'Full reset', expiresAt: null };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function harness(store = new UsageStore(':memory:'), client = {}) {
  const auth = new EventEmitter();
  auth.session = session;
  auth.usageSession = () => auth.session;
  let reads = 0, spends = 0;
  const usage = new CodexUsage(auth, store, {
    read: async () => { reads++; return { snapshot: parseUsage(wireUsage, Date.now()), credits: [] }; },
    credits: async () => ({ available: 2, credits: [credit] }),
    consume: async () => { spends++; return 'reset'; }, ...client,
  });
  return { auth, usage, store, reads: () => reads, spends: () => spends, close: async () => { await usage.close(); store.close(); } };
}

test('usage decoding identifies the weekly window and never invents reset availability', () => {
  assert.equal(parseUsage(wireUsage, 1).weekly.usedPercent, 65);
  assert.equal(parseUsage({ rate_limit: { primary_window: wireUsage.rate_limit.primary_window } }, 1).weekly, null);
  assert.equal(parseUsage({}, 1).availableResets, null);
  assert.throws(() => parseUsage({ rate_limit_reset_credits: { available_count: -1 } }, 1));
  const result = parseCredits({ available_count: 4, credits: [
    { id: 'valid', status: 'available', reset_type: 'codex_rate_limits' },
    { id: 'used', status: 'redeemed', reset_type: 'codex_rate_limits' },
    { id: 'expired', status: 'available', reset_type: 'codex_rate_limits', expires_at: '2000-01-01' },
    { id: 'unknown', status: 'available', reset_type: 'something_new' },
  ] }, Date.now());
  assert.deepEqual(result.credits.map((item) => item.id), ['valid']);
});

test('read-only endpoints cannot consume credits; POST has one attempt and stable redemption ID', async () => {
  const requests = [];
  const client = new CodexUsageClient(async (url, options) => {
    requests.push({ url, ...options });
    if (options.method === 'POST') throw new Error('response lost');
    return Response.json(url.endsWith('/usage') ? wireUsage : { available_count: 0, credits: [] });
  });
  const signal = new AbortController().signal;
  await client.read(session, signal);
  await client.credits(session, signal);
  assert.ok(requests.every((request) => request.method === 'GET'));
  assert.ok(requests.every((request) => request.headers['ChatGPT-Account-Id'] === 'account' && !('x-openai-codex-luna-reserve' in request.headers)));
  assert.equal(await client.consume(session, 'credit', 'request-id', signal), 'unknown');
  const posts = requests.filter((request) => request.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume');
  assert.deepEqual(JSON.parse(posts[0].body), { credit_id: 'credit', redeem_request_id: 'request-id' });
});

test('usage refresh is cached and deduplicated; preparing, cancelling and refreshing spend nothing', async () => {
  const h = harness();
  try {
    await Promise.all([h.usage.refresh(), h.usage.refresh(), h.usage.refresh()]);
    assert.equal(h.reads(), 1);
    await h.usage.refresh();
    assert.equal(h.reads(), 1);
    const intent = await h.usage.prepare();
    h.usage.cancel(intent.id);
    await assert.rejects(h.usage.confirm(intent.id), /expired or was cancelled/);
    await assert.rejects(h.usage.confirm('fabricated'), /expired or was cancelled/);
    await h.usage.refresh(true);
    assert.equal(h.reads(), 2);
    assert.equal(h.spends(), 0);
  } finally { await h.close(); }
});

test('only confirmed intent spends once, including double-clicks and replay after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-usage-'));
  const filename = join(root, 'usage.sqlite');
  const gate = deferred();
  let posts = 0;
  const h = harness(new UsageStore(filename), { consume: async () => { posts++; await gate.promise; return 'reset'; } });
  try {
    const intent = await h.usage.prepare();
    const first = h.usage.confirm(intent.id);
    assert.equal(await h.usage.confirm(intent.id), 'unknown');
    assert.equal(posts, 1);
    gate.resolve();
    assert.equal(await first, 'reset');
    assert.equal(await h.usage.confirm(intent.id), 'reset');
    assert.equal(posts, 1);
    await h.close();
    const reopened = harness(new UsageStore(filename));
    assert.equal(await reopened.usage.confirm(intent.id), 'reset');
    await assert.rejects(reopened.usage.prepare(), /No eligible/);
    assert.equal(reopened.spends(), 0);
    await reopened.close();
  } finally { gate.resolve(); await rm(root, { recursive: true, force: true }); }
});

test('unknown outcomes survive restart and block any further credit spending', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-usage-'));
  const filename = join(root, 'usage.sqlite');
  const h = harness(new UsageStore(filename), { consume: async () => 'unknown' });
  try {
    const intent = await h.usage.prepare();
    assert.equal(await h.usage.confirm(intent.id), 'unknown');
    await h.close();
    const reopened = harness(new UsageStore(filename));
    await assert.rejects(reopened.usage.prepare(), /unknown outcome/);
    assert.equal(reopened.usage.state.snapshot.canReset, false);
    assert.equal(reopened.spends(), 0);
    await reopened.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('expired confirmations and failed durable claims cannot send a reset', async () => {
  const h = harness();
  const now = Date.now;
  try {
    const expired = await h.usage.prepare();
    Date.now = () => now() + 180_000;
    await assert.rejects(h.usage.confirm(expired.id), /expired/);
    Date.now = now;
    const intent = await h.usage.prepare();
    h.store.claim = () => { throw new Error('Disk full'); };
    await assert.rejects(h.usage.confirm(intent.id), /Disk full/);
    assert.equal(h.spends(), 0);
  } finally { Date.now = now; await h.close(); }
});

test('cached usage stays visible offline without a redundant fresh-cache fetch', async () => {
  const store = new UsageStore(':memory:');
  store.save(session.key, parseUsage(wireUsage, Date.now()));
  let requests = 0;
  const h = harness(store, { read: async () => { requests++; throw new Error('Offline'); } });
  try {
    assert.equal(h.usage.state.snapshot.weekly.usedPercent, 65);
    await h.usage.refresh();
    assert.equal(requests, 0);
    await h.usage.refresh(true);
    assert.equal(h.usage.state.snapshot.weekly.usedPercent, 65);
    assert.ok(h.usage.state.message);
    assert.equal(h.spends(), 0);
  } finally { await h.close(); }
});

test('account changes discard late reads and invalidate pending reset confirmations', async () => {
  const gate = deferred();
  const h = harness(undefined, { read: () => gate.promise });
  try {
    const intent = await h.usage.prepare();
    const reading = h.usage.refresh();
    h.auth.session = { ...session, key: 'other', epoch: 2 };
    h.auth.emit('change');
    gate.resolve({ snapshot: parseUsage(wireUsage, Date.now()), credits: [] });
    await reading;
    assert.equal(h.usage.state.snapshot, null);
    await assert.rejects(h.usage.confirm(intent.id), /expired or was cancelled/);
    assert.equal(h.spends(), 0);
  } finally { await h.close(); }
});
