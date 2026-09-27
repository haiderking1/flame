import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexModels } from '../dist/backend/models/service.js';
import { ModelsStore } from '../dist/backend/models/store.js';
import { effortLabel } from '../src/renderer/components/composer/thinking/effortLabel.ts';

const model = (id, levels, defaultReasoning) => ({ id, name: id, description: '', defaultReasoning, supportsFast: id !== 'plain',
  reasoningLevels: levels.map((effort) => ({ effort, description: `Description for ${effort}` })) });
const catalog = { fetchedAt: Date.now(), etag: null, models: [model('alpha', ['low', 'high'], 'high'), model('beta', ['low', 'medium'], 'medium'), model('plain', [], null)] };
const session = { key: 'account-a', accountId: 'test-account', access: 'test-access', epoch: 1 };
function setup(store = new ModelsStore(':memory:'), client = { read: async () => catalog }) {
  store.save(session.key, catalog);
  const auth = new EventEmitter();
  auth.session = session;
  auth.usageSession = () => auth.session;
  const models = new CodexModels(auth, store, client);
  return { auth, models, store, close: async () => { await models.close(); store.close(); } };
}

test('thinking selection uses model defaults, preserves supported efforts and falls back when switching models', async () => {
  const h = setup();
  try {
    h.models.selectModel(session.key, 'alpha');
    assert.deepEqual(h.models.state.selection, { modelId: 'alpha', effort: 'high', serviceTier: 'default' });
    h.models.selectThinking(session.key, 'alpha', 'low');
    h.models.selectModel(session.key, 'beta');
    assert.deepEqual(h.models.state.selection, { modelId: 'beta', effort: 'low', serviceTier: 'default' });
    h.models.selectThinking(session.key, 'beta', 'medium');
    h.models.selectModel(session.key, 'alpha');
    assert.equal(h.models.state.selection.effort, 'high');
    h.models.selectModel(session.key, 'plain');
    assert.equal(h.models.state.selection.effort, null);
    assert.throws(() => h.models.selectThinking(session.key, 'plain', 'high'), /not supported/);
  } finally { await h.close(); }
});

test('backend rejects invalid efforts, stale model requests, foreign accounts and disconnected requests', async () => {
  const h = setup();
  try {
    h.models.selectModel(session.key, 'alpha');
    const before = h.models.state.selection;
    assert.throws(() => h.models.selectThinking(session.key, 'alpha', 'invented'), /not supported/);
    assert.throws(() => h.models.selectThinking(session.key, 'beta', 'low'), /model changed/);
    assert.throws(() => h.models.selectThinking('account-b', 'alpha', 'low'), /Account changed/);
    assert.throws(() => h.models.selectModel(session.key, 'missing'), /no longer available/);
    assert.deepEqual(h.models.state.selection, before);
    h.auth.session = null;
    h.auth.emit('change');
    assert.equal(h.models.state.selection, null);
    assert.throws(() => h.models.selectThinking(session.key, 'alpha', 'low'), /disconnected/);
  } finally { await h.close(); }
});

test('model and thinking choices persist across restarts and remain account-scoped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-thinking-'));
  const filename = join(root, 'models.sqlite');
  const h = setup(new ModelsStore(filename));
  try {
    h.models.selectModel(session.key, 'alpha');
    h.models.selectThinking(session.key, 'alpha', 'low');
    h.models.selectTier(session.key, 'alpha', 'priority');
    await h.close();
    const restored = setup(new ModelsStore(filename));
    try {
      assert.deepEqual(restored.models.state.selection, { modelId: 'alpha', effort: 'low', serviceTier: 'priority' });
      restored.store.save('account-b', catalog);
      restored.auth.session = { ...session, key: 'account-b', epoch: 2 };
      restored.auth.emit('change');
      assert.equal(restored.models.state.selection, null);
      restored.models.selectModel('account-b', 'beta');
      restored.auth.session = { ...session, epoch: 3 };
      restored.auth.emit('change');
      assert.deepEqual(restored.models.state.selection, { modelId: 'alpha', effort: 'low', serviceTier: 'priority' });
    } finally { await restored.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cache refresh reconciles removed thinking levels and does not overwrite newer selections', async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const h = setup(undefined, { read: () => response });
  try {
    h.models.selectModel(session.key, 'alpha');
    const refresh = h.models.refresh(true);
    h.models.selectThinking(session.key, 'alpha', 'low');
    resolve({ ...catalog, models: [model('alpha', ['low', 'medium'], 'medium')] });
    await refresh;
    assert.equal(h.models.state.selection.effort, 'low');
  } finally { await h.close(); }
  const changed = setup(undefined, { read: async () => ({ ...catalog, models: [model('alpha', ['medium'], 'medium')] }) });
  try {
    changed.models.selectModel(session.key, 'alpha');
    await changed.models.refresh(true);
    assert.equal(changed.models.state.selection.effort, 'medium');
  } finally { await changed.close(); }
});

test('failed persistence does not falsely publish a selected thinking level', async () => {
  const h = setup();
  try {
    h.models.selectModel(session.key, 'alpha');
    h.store.saveSelection = () => { throw new Error('private filesystem details'); };
    assert.throws(() => h.models.selectThinking(session.key, 'alpha', 'low'), (error) => /Could not save/.test(error.message) && !error.message.includes('private'));
    assert.equal(h.models.state.selection.effort, 'high');
    assert.throws(() => h.models.selectTier(session.key, 'alpha', 'priority'), /Could not save/);
    assert.equal(h.models.state.selection.serviceTier, 'default');
  } finally { await h.close(); }
});

test('Fast requires explicit opt-in, survives thinking changes and falls back on unsupported models', async () => {
  const h = setup();
  try {
    h.models.selectModel(session.key, 'alpha');
    assert.equal(h.models.state.selection.serviceTier, 'default');
    h.models.selectTier(session.key, 'alpha', 'priority');
    h.models.selectThinking(session.key, 'alpha', 'low');
    assert.equal(h.models.state.selection.serviceTier, 'priority');
    assert.equal(h.store.loadSelection(session.key).serviceTier, 'priority');
    h.models.selectModel(session.key, 'beta');
    assert.equal(h.models.state.selection.serviceTier, 'priority');
    assert.throws(() => h.models.selectTier(session.key, 'alpha', 'default'), /model changed/);
    assert.throws(() => h.models.selectTier('other-account', 'beta', 'priority'), /Account changed/);
    assert.throws(() => h.models.selectTier(session.key, 'beta', 'invented'), /not supported/);
    h.models.selectTier(session.key, 'beta', 'default');
    assert.equal(h.models.state.selection.serviceTier, 'default');
    h.models.selectTier(session.key, 'beta', 'priority');
    h.models.selectModel(session.key, 'plain');
    assert.equal(h.models.state.selection.serviceTier, 'default');
    assert.throws(() => h.models.selectTier(session.key, 'plain', 'priority'), /not supported/);
  } finally { await h.close(); }
});

test('thinking labels format display names without altering provider effort values', () => {
  assert.equal(effortLabel('xhigh'), 'Extra High');
  assert.equal(effortLabel('medium'), 'Medium');
  assert.equal(effortLabel('future_level'), 'Future Level');
});
