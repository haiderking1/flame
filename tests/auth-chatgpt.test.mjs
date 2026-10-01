import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexAuth } from '../dist/backend/auth/service.js';
import { AuthStore } from '../dist/backend/auth/store.js';
import { listenForCallback } from '../dist/backend/auth/callback.js';
import { chatgptSignIn, ChatGPTTokens } from '../dist/backend/auth/chatgpt/protocol.js';
import { OpenAIKeys } from '../dist/backend/auth/chatgpt/id-token.js';
import { codexSignIn } from '../dist/backend/auth/codex/protocol.js';
import { allowedOAuthUrl } from '../dist/main/oauthBrowser.js';
import { fakeOpenAIAuth } from './helpers/chatgptAuth.mjs';

const HOST = 'urn:uuid:0f8fad5b-d9cb-469f-a165-70867728950e';
const signal = () => new AbortController().signal;
async function wait(check, what = 'authentication') { for (let i = 0; i < 200; i++) { if (await check()) return; await delay(10); } assert.fail(`Timed out waiting for ${what}`); }
const tokensFor = fake => new ChatGPTTokens(fake.fetch, new OpenAIKeys(fake.fetch));
/** Starts a sign-in and returns its browser URL's parameters and the callback that answers it. */
async function start(method, fake, previous = null) {
  const flow = await method.authorize({ previous, hostId: async () => HOST });
  const url = new URL(flow.url(43123));
  fake.nonce = url.searchParams.get('nonce');
  return { flow, url, params: url.searchParams };
}

test('Sign in with ChatGPT registers Flame with PKCE, verifies the ID token and requires plan usage', async () => {
  const fake = fakeOpenAIAuth();
  const method = chatgptSignIn(tokensFor(fake));
  const { flow, url, params } = await start(method, fake);
  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize');
  assert.deepEqual(Object.fromEntries([...params].filter(([key]) => !['state', 'nonce', 'code_challenge'].includes(key))), {
    client_id: 'dynamic_agent_client', response_type: 'code', redirect_uri: 'http://127.0.0.1:43123/callback',
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource: 'https://api.openai.com/v1',
    code_challenge_method: 'S256', ext_agent_host_id: HOST, agent_name_hint: 'Flame' });
  assert.equal(params.get('state'), flow.state);
  assert.deepEqual(flow.callback, { port: 0, path: '/callback' });
  assert.ok(allowedOAuthUrl(url.href), 'the main process opens the authorize page');
  for (const unsafe of [url.href.replace('127.0.0.1', 'evil.test'), url.href.replace('api.openai.com', 'evil.test'), url.href.replace('/api/accounts/authorize', '/other')]) assert.equal(allowedOAuthUrl(unsafe), false);

  const callback = new URLSearchParams({ code: 'the-code', state: flow.state, client_id: 'oaiapp_flame1' });
  const credential = await flow.complete(callback, signal());
  const exchange = fake.requests.at(-1);
  assert.equal(exchange.url, 'https://auth.openai.com/api/accounts/oauth/token');
  assert.equal(exchange.body.client_id, 'oaiapp_flame1');
  assert.equal(exchange.body.resource, 'https://api.openai.com/v1');
  assert.equal(exchange.body.redirect_uri, 'http://127.0.0.1:43123/callback');
  assert.equal(params.get('code_challenge'), createHash('sha256').update(exchange.body.code_verifier).digest('base64url'));
  assert.equal(exchange.body.client_secret, undefined);
  assert.deepEqual({ method: credential.method, clientId: credential.clientId, subject: credential.subject, email: credential.email, access: credential.access },
    { method: 'chatgpt', clientId: 'oaiapp_flame1', subject: 'user-subject', email: 'plan@example.com', access: 'access-0' });
  assert.ok(credential.scopes.includes('chatgpt.tokens.use.direct'));

  // A callback without the issued client, or with the placeholder, is an unfinished registration.
  for (const clientId of [null, 'dynamic_agent_client']) {
    const next = await start(method, fake);
    const query = new URLSearchParams({ code: 'c', state: next.flow.state, ...(clientId ? { client_id: clientId } : {}) });
    await assert.rejects(next.flow.complete(query, signal()), /did not finish registering/);
  }
  // Without plan usage the sign-in is useless to Flame.
  const narrow = await start(method, fake);
  fake.scope = 'openid profile email offline_access';
  await assert.rejects(narrow.flow.complete(new URLSearchParams({ code: 'c', client_id: 'oaiapp_flame1' }), signal()), error => error.terminal && /not allowed to use your ChatGPT plan/.test(error.message));
  fake.scope = 'chatgpt.tokens.use.direct openid';
});

test('an ID token that is forged, for another client, from another issuer, expired or for another nonce is refused', async () => {
  const fake = fakeOpenAIAuth();
  const method = chatgptSignIn(tokensFor(fake));
  const forged = [
    () => fake.idToken({}, fake.foreignKey),
    () => fake.idToken({ aud: 'oaiapp_someone_else' }),
    () => fake.idToken({ iss: 'https://evil.test' }),
    () => fake.idToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
    () => fake.idToken({ nonce: 'replayed' }),
    () => 'not.a.jwt',
  ];
  for (const token of forged) {
    const { flow } = await start(method, fake);
    fake.reply = () => { fake.lastClient = 'oaiapp_flame1'; return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: fake.scope, id_token: token() }); };
    await assert.rejects(flow.complete(new URLSearchParams({ code: 'c', client_id: 'oaiapp_flame1' }), signal()), /could not verify/);
  }
});

test('signing in again reuses the saved registration, never adopts another, and refresh rotates tokens for the same account', async () => {
  const fake = fakeOpenAIAuth();
  const tokens = tokensFor(fake);
  const method = chatgptSignIn(tokens);
  const first = await start(method, fake);
  const saved = await first.flow.complete(new URLSearchParams({ code: 'c', client_id: 'oaiapp_flame1' }), signal());

  const again = await start(method, fake, saved);
  assert.equal(again.params.get('client_id'), 'oaiapp_flame1');
  assert.equal(again.params.get('id_token_hint'), saved.idToken);
  assert.equal(again.params.get('login_hint'), 'plan@example.com');
  assert.equal(again.params.get('agent_name_hint'), null);
  assert.ok(allowedOAuthUrl(again.url.href));
  await assert.rejects(again.flow.complete(new URLSearchParams({ code: 'c', client_id: 'oaiapp_other' }), signal()), /different registration/);
  const resumed = await again.flow.complete(new URLSearchParams({ code: 'c' }), signal());
  assert.equal(resumed.clientId, 'oaiapp_flame1');
  fake.subject = 'someone-else';
  const switched = await start(method, fake, saved);
  await assert.rejects(switched.flow.complete(new URLSearchParams({ code: 'c' }), signal()), error => error.terminal && /different account/.test(error.message));
  fake.subject = 'user-subject';

  const refreshed = await method.refresh(saved, signal());
  assert.deepEqual(fake.requests.at(-1).body, { grant_type: 'refresh_token', client_id: 'oaiapp_flame1', refresh_token: saved.refresh, resource: 'https://api.openai.com/v1' });
  assert.equal(refreshed.refresh, 'refresh-1', 'the rotated refresh token replaces the old one');
  assert.equal(refreshed.idToken, saved.idToken, 'a refresh without an ID token keeps the verified one');
  fake.reply = Response.json({ error: 'invalid_grant' }, { status: 400 });
  await assert.rejects(method.refresh(refreshed, signal()), error => error.terminal);
  fake.reply = () => Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: fake.scope, id_token: fake.idToken({ sub: 'someone-else', aud: 'oaiapp_flame1' }) });
  await assert.rejects(method.refresh(refreshed, signal()), error => error.terminal && /different account/.test(error.message));
});

test('Sign in with ChatGPT completes through the browser callback, persists, and replaces or yields to the legacy sign-in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-chatgpt-auth-'));
  const directory = join(root, '.flame', 'agent'), file = join(directory, 'auth.json');
  const fake = fakeOpenAIAuth();
  const legacyJwt = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'legacy-account' } })).toString('base64url')}.signature`;
  const legacy = { type: 'oauth', access: legacyJwt, refresh: 'legacy-refresh', expires: Date.now() + 3_600_000, accountId: 'legacy-account', email: null, plan: null };
  const opened = [];
  const auth = new CodexAuth({ store: new AuthStore(directory),
    methods: { chatgpt: chatgptSignIn(tokensFor(fake)), codex: codexSignIn({ exchange: async () => legacy, refresh: async () => legacy }) },
    // The legacy callback's fixed port may be taken on this machine; its sign-in is cancelled before any redirect.
    callback: (state, abort, options) => listenForCallback(state, abort, { ...options, port: 0 }),
    openBrowser: async (href) => {
      assert.ok(allowedOAuthUrl(href));
      const url = new URL(href); opened.push(url);
      if (url.pathname === '/oauth/authorize') return;
      fake.nonce = url.searchParams.get('nonce');
      const redirect = new URL(url.searchParams.get('redirect_uri'));
      redirect.search = new URLSearchParams({ code: 'browser-code', state: url.searchParams.get('state'), client_id: 'oaiapp_flame1', scope: fake.scope }).toString();
      const response = await fetch(redirect);
      assert.equal(response.status, 200);
    } });
  try {
    await auth.initialize();
    auth.login('chatgpt');
    assert.equal(auth.state.method, 'chatgpt');
    await wait(() => auth.state.phase === 'connected');
    assert.deepEqual(auth.state, { phase: 'connected', method: 'chatgpt', account: { email: 'plan@example.com', plan: null }, message: null });
    const session = auth.usageSession();
    assert.deepEqual({ method: session.method, accountId: session.accountId, access: session.access }, { method: 'chatgpt', accountId: null, access: 'access-0' });
    assert.equal(session.key, createHash('sha256').update('chatgpt\0user-subject').digest('hex'));
    let stored = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(stored['openai-chatgpt'].clientId, 'oaiapp_flame1');
    assert.match(stored['openai-agent-host'], /^urn:uuid:[0-9a-f-]{36}$/);
    const host = stored['openai-agent-host'];
    assert.equal(opened[0].searchParams.get('ext_agent_host_id'), host);
    await auth.refresh();
    assert.equal(JSON.parse(await readFile(file, 'utf8'))['openai-chatgpt'].refresh, 'refresh-1');

    // The restart restores the sign-in without a browser.
    const reopened = new CodexAuth({ store: new AuthStore(directory), openBrowser: async () => assert.fail('No browser needed to restore a session') });
    await reopened.initialize();
    assert.equal(reopened.state.method, 'chatgpt');
    assert.equal(reopened.state.phase, 'connected');
    await reopened.close();

    // The legacy sign-in replaces it, and signing out keeps the installation's host ID.
    auth.login('codex');
    await wait(() => opened.length === 2);
    assert.equal(opened[1].pathname, '/oauth/authorize');
    await auth.cancel();
    assert.equal(auth.state.method, 'chatgpt', 'a cancelled legacy sign-in keeps the ChatGPT sign-in');
    await auth.logout();
    stored = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(stored, { 'openai-agent-host': host });
    auth.login('chatgpt');
    await wait(() => auth.state.phase === 'connected');
    assert.equal(opened.at(-1).searchParams.get('client_id'), 'dynamic_agent_client', 'after signing out, signing in registers anew');
    assert.equal(opened.at(-1).searchParams.get('ext_agent_host_id'), host);
  } finally { await auth.close(); await rm(root, { recursive: true, force: true }); }
});

test('auth.json keeps one sign-in method at a time and a stable agent host ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-auth-store-'));
  const store = new AuthStore(join(root, 'agent'));
  try {
    const host = await store.agentHostId();
    const [again, concurrent] = await Promise.all([store.agentHostId(), store.save({ type: 'oauth', access: 'a', refresh: 'r', expires: Date.now() + 1000, accountId: 'acc', email: null, plan: null })]);
    void concurrent;
    assert.equal(again, host);
    assert.equal((await store.load()).accountId, 'acc');
    await store.save({ type: 'oauth', method: 'chatgpt', access: 'a', refresh: 'r', expires: Date.now() + 1000, clientId: 'oaiapp_x', subject: 's', idToken: 'i', scopes: ['chatgpt.tokens.use.direct'], email: null, plan: null });
    const data = JSON.parse(await readFile(join(root, 'agent', 'auth.json'), 'utf8'));
    assert.deepEqual(Object.keys(data).sort(), ['openai-agent-host', 'openai-chatgpt']);
    assert.equal((await store.load()).method, 'chatgpt');
    assert.equal(await new AuthStore(join(root, 'agent')).agentHostId(), host);
  } finally { await rm(root, { recursive: true, force: true }); }
});
