import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexModelsClient, CATALOG_URL } from '../dist/backend/models/client.js';
import { parseModels } from '../dist/backend/models/payload.js';
import { ModelsStore } from '../dist/backend/models/store.js';
import { CodexModels } from '../dist/backend/models/service.js';

const wire = (slug, priority = 1) => ({ slug, display_name: slug.toUpperCase(), description: 'Coding model', priority, visibility: 'list',
  default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium', description: 'Balanced' }, { effort: 'high', description: 'More reasoning' }] });
const session = { key: 'account-a', accountId: 'test-account', access: 'test-access', epoch: 1 };
const catalog = () => ({ fetchedAt: Date.now(), etag: '"catalog-v1"', models: parseModels({ models: [wire('test-model')] }) });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function harness(store = new ModelsStore(':memory:'), client) {
  const auth = new EventEmitter();
  auth.session = session;
  auth.usageSession = () => auth.session;
  let requests = 0;
  const models = new CodexModels(auth, store, client ?? { read: async () => { requests++; return catalog(); } });
  return { auth, store, models, requests: () => requests, close: async () => { await models.close(); store.close(); } };
}

test('catalog parsing uses provider order, visibility and reasoning metadata, without pinned model IDs', () => {
  const models = parseModels({ models: [wire('second', 2), { ...wire('hidden'), visibility: 'hide' }, wire('first', 0), { ...wire('future'), visibility: 'future' }] });
  assert.deepEqual(models.map((model) => model.id), ['first', 'second']);
  assert.equal(models[0].defaultReasoning, 'medium');
  assert.deepEqual(models[0].reasoningLevels.map((level) => level.effort), ['medium', 'high']);
  assert.throws(() => parseModels({ models: [wire('duplicate'), wire('duplicate')] }), /invalid model catalog/);
  assert.throws(() => parseModels({ models: [{ ...wire('bad'), supported_reasoning_levels: 'wrong' }] }), /invalid model catalog/);
  assert.deepEqual(parseModels({ models: [] }), []);
});

test('Fast support is discovered from modern or legacy tier metadata, never provider defaults alone', () => {
  const read = (extra) => parseModels({ models: [{ ...wire('tier-model'), ...extra }] })[0].supportsFast;
  assert.equal(read({}), false);
  assert.equal(read({ service_tiers: [{ id: 'priority', name: 'Fast', description: 'More usage' }] }), true);
  assert.equal(read({ additional_speed_tiers: ['fast'] }), true);
  assert.equal(read({ default_service_tier: 'priority' }), false);
  assert.equal(read({ service_tiers: [{ id: 'future' }] }), false);
  assert.throws(() => read({ service_tiers: 'priority' }), /invalid service tier/);
  assert.throws(() => read({ service_tiers: [{ id: 'priority' }, { id: 'priority' }] }), /invalid service tier/);
  assert.throws(() => read({ additional_speed_tiers: [42] }), /invalid service tier/);
});

test('old catalog caches refetch tier capabilities and old saved selections migrate to Standard', () => {
  const store = new ModelsStore(':memory:');
  try {
    const old = catalog();
    delete old.models[0].supportsFast;
    store.save(session.key, old);
    assert.equal(store.load(session.key), null);
    store.saveSelection(session.key, { modelId: 'test-model', effort: 'high' });
    assert.deepEqual(store.loadSelection(session.key), { modelId: 'test-model', effort: 'high', serviceTier: 'default' });
  } finally { store.close(); }
});

test('catalog GET authenticates only in backend, revalidates ETag and redacts network/provider errors', async () => {
  const requests = [];
  const client = new CodexModelsClient(async (url, options) => {
    requests.push({ url, ...options });
    return requests.length === 1 ? Response.json({ models: [wire('remote')] }, { headers: { etag: '"remote-v1"' } }) : new Response(null, { status: 304 });
  });
  const signal = new AbortController().signal;
  const first = await client.read(session, null, signal);
  const second = await client.read(session, first, signal);
  assert.equal(requests[0].url, CATALOG_URL);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].headers.Authorization, 'Bearer test-access');
  assert.equal(requests[0].headers['ChatGPT-Account-Id'], session.accountId);
  assert.equal(requests[1].headers['If-None-Match'], '"remote-v1"');
  assert.deepEqual(first.models, second.models);
  assert.ok(!JSON.stringify(second).includes('test-access'));
  const denied = new CodexModelsClient(async () => new Response('test-access private provider details', { status: 401 }));
  await assert.rejects(denied.read(session, null, signal), (error) => /authorize/.test(error.message) && !JSON.stringify(error).includes('test-access'));
  const offline = new CodexModelsClient(async () => { throw new Error('test-access'); });
  await assert.rejects(offline.read(session, null, signal), (error) => !JSON.stringify(error).includes('test-access'));
});

test('model refreshes are deduplicated and fresh caches do not refetch on picker reopen', async () => {
  const h = harness();
  try {
    await Promise.all([h.models.refresh(), h.models.refresh(), h.models.refresh()]);
    const stop = h.models.watch(() => {});
    stop();
    await h.models.refresh();
    assert.equal(h.requests(), 1);
    assert.equal(h.models.state.catalog.models[0].id, 'test-model');
    assert.ok(!JSON.stringify(h.models.state).includes('test-access'));
  } finally { await h.close(); }
});

test('cached catalogs survive restart and remain visible on offline refresh', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-models-'));
  const filename = join(root, 'models.sqlite');
  const initial = harness(new ModelsStore(filename));
  try {
    await initial.models.refresh();
    await initial.close();
    let requests = 0;
    const restored = harness(new ModelsStore(filename), { read: async () => { requests++; throw new Error('Offline'); } });
    try {
      assert.equal(restored.models.state.catalog.models[0].id, 'test-model');
      await restored.models.refresh();
      assert.equal(requests, 0);
      await restored.models.refresh(true);
      assert.equal(restored.models.state.catalog.models[0].id, 'test-model');
      assert.ok(restored.models.state.message);
    } finally { await restored.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('sign-out and account switches fence late model responses and scope cached catalogs', async () => {
  const gate = deferred();
  const h = harness(undefined, { read: () => gate.promise });
  try {
    const flight = h.models.refresh();
    h.auth.session = { ...session, key: 'account-b', epoch: 2 };
    h.auth.emit('change');
    gate.resolve(catalog());
    await flight;
    assert.equal(h.models.state.catalog, null);
    assert.equal(h.store.load('account-b'), null);
    h.auth.session = null;
    h.auth.emit('change');
    await h.models.refresh(true);
    assert.equal(h.models.state.connected, false);
    assert.equal(h.models.state.catalog, null);
  } finally { await h.close(); }
});

test('cache write failure keeps the live catalog usable and reports persistence failure', async () => {
  const h = harness();
  try {
    h.store.save = () => { throw new Error('Disk full'); };
    await h.models.refresh();
    assert.equal(h.models.state.catalog.models[0].id, 'test-model');
    assert.match(h.models.state.message, /cache could not be saved/);
  } finally { await h.close(); }
});
