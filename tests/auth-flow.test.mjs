import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAuth } from '../dist/backend/auth/service.js';
import { AuthStore } from '../dist/backend/auth/store.js';
import { codexSignIn, CodexTokens } from '../dist/backend/auth/codex/protocol.js';
import { listenForCallback } from '../dist/backend/auth/callback.js';

async function wait(check) { for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); } assert.fail('Timed out waiting for authentication'); }
const credential = { type: 'oauth', access: 'access', refresh: 'refresh', expires: Date.now() + 3_600_000, accountId: 'account', email: null, plan: null };

test('browser callback, token exchange, disk persistence and restart form a complete OAuth lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-oauth-flow-'));
  const store = new AuthStore(join(root, '.flame', 'agent'));
  let port, page;
  const auth = new CodexAuth({ store,
    callback: async (state, signal, callback) => { const listener = await listenForCallback(state, signal, { ...callback, port: 0 }); port = listener.port; return listener; },
    // Like a real browser, opening the page returns at once; the page answers when the sign-in finishes.
    openBrowser: async (url) => {
      const state = new URL(url).searchParams.get('state');
      page = fetch(`http://127.0.0.1:${port}/auth/callback?state=${state}&code=test-code`).then(response => response.text());
    },
    methods: { codex: codexSignIn(new CodexTokens(async (_url, init) => {
      assert.equal(init.body.get('code'), 'test-code');
      const jwt = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account' } })).toString('base64url')}.signature`;
      return Response.json({ access_token: jwt, refresh_token: 'test-refresh', expires_in: 3600 });
    })) },
  });
  try {
    await auth.initialize();
    auth.login('codex');
    await wait(() => auth.state.phase === 'connected');
    assert.ok((await page).includes('You&#39;re signed in'), 'the browser shows the finished sign-in');
    assert.equal((await store.load()).refresh, 'test-refresh');
    await auth.close();
    const reopened = new CodexAuth({ store: new AuthStore(join(root, '.flame', 'agent')), openBrowser: async () => assert.fail('No browser needed to restore a session') });
    await reopened.initialize();
    assert.equal(reopened.state.phase, 'connected');
    await reopened.logout();
    assert.equal(await store.load(), null);
    await reopened.close();
  } finally { await auth.close(); await rm(root, { recursive: true, force: true }); }
});

test('cancellation rolls back a login already inside an atomic credential write', async () => {
  let saved = null;
  let release;
  let writing = false;
  const commit = new Promise((resolve) => { release = resolve; });
  const auth = new CodexAuth({
    store: { load: async () => saved, save: async (value) => { if (value) { writing = true; await commit; } saved = value; }, agentHostId: async () => 'urn:uuid:00000000-0000-4000-8000-000000000000' },
    openBrowser: async () => {},
    callback: async () => ({ params: Promise.resolve(new URLSearchParams({ code: 'code' })), port: 0, close() {} }),
    methods: { codex: codexSignIn({ exchange: async () => credential, refresh: async () => credential }) },
  });
  await auth.initialize();
  auth.login('codex');
  await wait(() => writing);
  const cancelled = auth.cancel();
  release();
  await cancelled;
  assert.equal(saved, null);
  assert.equal(auth.state.phase, 'disconnected');
  await auth.close();
});
