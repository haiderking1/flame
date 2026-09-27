import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { AuthStore } from '../dist/backend/auth/store.js';
import { CodexAuth } from '../dist/backend/auth/service.js';
import { OAuthFailure, credentialFromResponse } from '../dist/backend/auth/credentials.js';
import { authorization, CodexTokens, REDIRECT_URI } from '../dist/backend/auth/codex/protocol.js';
import { listenForCode } from '../dist/backend/auth/codex/callback.js';
import { allowedOAuthUrl } from '../dist/main/oauthBrowser.js';

const jwt = (payload) => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const tokens = (refresh = 'refresh-secret') => ({ access_token: jwt({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'account', chatgpt_plan_type: 'plus' } }), refresh_token: refresh,
  id_token: jwt({ email: 'test@example.com' }), expires_in: 3600 });
const credential = () => credentialFromResponse(tokens());
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
async function wait(check) { for (let i = 0; i < 100; i++) { if (check()) return; await delay(10); } assert.fail('Timed out waiting for auth state'); }

test('Codex OAuth uses PKCE, scoped browser URL, and safe token exchange/refresh', async () => {
  const flow = authorization();
  const url = new URL(flow.url);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(flow.verifier).digest('base64url'));
  assert.notEqual(authorization().state, flow.state);
  assert.ok(allowedOAuthUrl(flow.url));
  for (const value of ['file:///etc/passwd', 'https://auth.openai.com.evil.test/oauth/authorize', flow.url.replace('localhost%3A1455', 'evil.test'), flow.url.replace('https://', 'https://user:password@')]) assert.equal(allowedOAuthUrl(value), false);
  let request;
  const client = new CodexTokens(async (url, init) => { request = { url, init }; return Response.json(tokens()); });
  const saved = await client.exchange('code-secret', flow.verifier, new AbortController().signal);
  assert.equal(request.url, 'https://auth.openai.com/oauth/token');
  assert.equal(request.init.body.get('grant_type'), 'authorization_code');
  assert.equal(request.init.body.get('code_verifier'), flow.verifier);
  assert.equal(request.init.redirect, 'error');
  assert.equal(saved.email, 'test@example.com');
  assert.equal(saved.plan, 'plus');
  await client.refresh(saved, new AbortController().signal);
  assert.equal(request.init.body.get('grant_type'), 'refresh_token');
  assert.equal(request.init.body.get('refresh_token'), 'refresh-secret');
  const refreshed = credentialFromResponse({ access_token: tokens().access_token, expires_in: 3600 }, saved);
  assert.equal(refreshed.refresh, saved.refresh);
  assert.equal(refreshed.email, saved.email);
  for (const code of ['invalid_grant', 'refresh_token_expired', 'refresh_token_reused', 'refresh_token_invalidated']) {
    const denied = new CodexTokens(async () => Response.json({ error: { code, message: 'private-token-secret' } }, { status: 400 }));
    await assert.rejects(denied.refresh(saved, new AbortController().signal), (error) => error.terminal && !error.message.includes('private-token-secret'));
  }
  const malformed = new CodexTokens(async () => Response.json({ access_token: 'private-token-secret' }));
  await assert.rejects(malformed.exchange('code', 'verifier', new AbortController().signal), (error) => !error.message.includes('private-token-secret'));
  const offline = new CodexTokens(async () => { throw new Error('private-token-secret'); });
  await assert.rejects(offline.refresh(saved, new AbortController().signal), (error) => !error.terminal && !error.message.includes('private-token-secret'));
});

test('OAuth loopback callback validates state and host, handles denial, abort, replay and occupied ports', async () => {
  const controller = new AbortController();
  const listener = await listenForCode('expected-state', controller.signal, 0);
  const base = `http://127.0.0.1:${listener.port}`;
  try {
    assert.equal((await fetch(`${base}/auth/callback?state=wrong&code=secret`)).status, 400);
    const wrongHost = await new Promise((resolve, reject) => {
      const req = request(`${base}/auth/callback?state=expected-state&code=secret`, { headers: { host: 'evil.test' } }, (response) => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 400);
    assert.equal((await fetch(`${base}/auth/callback?state=expected-state&state=expected-state&code=secret`)).status, 400);
    assert.equal((await fetch(`${base}/other`)).status, 404);
    assert.equal((await fetch(`${base}/auth/callback?state=expected-state&code=secret`, { method: 'POST' })).status, 400);
    await assert.rejects(listenForCode('second', controller.signal, listener.port), /port 1455/);
    const response = await fetch(`${base}/auth/callback?state=expected-state&code=secret`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await listener.code, 'secret');
    assert.equal((await fetch(`${base}/auth/callback?state=expected-state&code=secret`)).status, 409);
  } finally { listener.close(); }
  const denied = await listenForCode('state', controller.signal, 0);
  await fetch(`http://127.0.0.1:${denied.port}/auth/callback?state=state&error=access_denied&error_description=secret`);
  await assert.rejects(denied.code, /not approved/);
  denied.close();
  const aborted = await listenForCode('state', controller.signal, 0);
  controller.abort();
  await assert.rejects(aborted.code, /cancelled/);
});

test('auth.json is private, atomic, preserves other providers, survives reopen, and refuses symlinks/corruption', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flame-auth-'));
  const directory = join(root, '.flame', 'agent');
  const path = join(directory, 'auth.json');
  const store = new AuthStore(directory);
  try {
    assert.equal(await store.load(), null);
    await writeFile(path, JSON.stringify({ other: { token: 'untouched' } }), { mode: 0o644 });
    await store.save(credential());
    assert.equal((await new AuthStore(directory).load()).accountId, 'account');
    if (process.platform !== 'win32') {
      assert.equal((await stat(directory)).mode & 0o777, 0o700);
      assert.equal((await stat(join(root, '.flame'))).mode & 0o777, 0o700);
      assert.equal((await stat(path)).mode & 0o777, 0o600);
    }
    await store.save(null);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { other: { token: 'untouched' } });
    await writeFile(path, '{bad-json-with-secret');
    await assert.rejects(store.load(), (error) => !error.message.includes('bad-json-with-secret'));
    await assert.rejects(store.save(credential()));
    assert.equal(await readFile(path, 'utf8'), '{bad-json-with-secret');
    await rm(path);
    const outside = join(root, 'outside');
    await writeFile(outside, '{}');
    await symlink(outside, path);
    await assert.rejects(store.load());
    await assert.rejects(store.save(credential()));
    assert.equal(await readFile(outside, 'utf8'), '{}');
    await rm(directory, { recursive: true });
    await mkdir(join(root, 'outside-directory'));
    await symlink(join(root, 'outside-directory'), directory);
    await assert.rejects(store.load());
  } finally { await rm(root, { recursive: true, force: true }); }
});

function harness(options = {}) {
  let saved = options.initial ?? null;
  let opens = 0;
  let calls = 0;
  const code = deferred();
  const auth = new CodexAuth({
    store: { load: async () => saved, save: async (value) => { if (options.save) await options.save(value); saved = value; } },
    openBrowser: async (url) => { assert.ok(allowedOAuthUrl(url)); opens++; if (options.openBrowser) await options.openBrowser(url); },
    callback: async (_state, signal) => ({ port: 1455, close() {}, code: Promise.race([code.promise, new Promise((_, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); })]) }),
    tokens: { exchange: async () => credential(), refresh: async (...args) => { calls++; return options.refresh ? options.refresh(...args) : credentialFromResponse(tokens('rotated')); } },
  });
  return { auth, code, saved: () => saved, opens: () => opens, calls: () => calls };
}

test('auth lifecycle signs in, publishes no secrets, refreshes once, persists rotation and signs out', async () => {
  const h = harness();
  await h.auth.initialize();
  try {
    h.auth.login(); h.auth.login();
    await wait(() => h.opens() === 1);
    assert.equal(h.auth.state.phase, 'authorizing');
    h.code.resolve('code');
    await wait(() => h.auth.state.phase === 'connected');
    assert.equal(h.saved().accountId, 'account');
    assert.deepEqual(h.auth.state.account, { email: 'test@example.com', plan: 'plus' });
    assert.ok(!JSON.stringify(h.auth.state).includes('refresh-secret'));
    await Promise.all([h.auth.refresh(), h.auth.refresh(), h.auth.refresh()]);
    assert.equal(h.calls(), 1);
    assert.equal(h.saved().refresh, 'rotated');
    await h.auth.logout();
    assert.equal(h.auth.state.phase, 'disconnected');
    assert.equal(h.saved(), null);
  } finally { await h.auth.close(); }
});

test('cancel and sign-out fence late login/refresh results, failures retain credentials unless revoked', async () => {
  const login = harness();
  await login.auth.initialize();
  login.auth.login();
  await wait(() => login.opens() === 1);
  await login.auth.cancel();
  login.code.resolve('late');
  await delay(10);
  assert.equal(login.auth.state.phase, 'disconnected');
  assert.equal(login.saved(), null);
  await login.auth.close();
  const pending = deferred();
  const logout = harness({ initial: credential(), refresh: () => pending.promise });
  await logout.auth.initialize();
  const task = logout.auth.refresh();
  await logout.auth.logout();
  pending.resolve(credential());
  await task;
  assert.equal(logout.auth.state.phase, 'disconnected');
  assert.equal(logout.saved(), null);
  await logout.auth.close();
  for (const terminal of [false, true]) {
    const h = harness({ initial: credential(), refresh: async () => { throw new OAuthFailure('Safe error', terminal); } });
    await h.auth.initialize();
    await h.auth.refresh();
    assert.equal(h.auth.state.phase, terminal ? 'disconnected' : 'connected');
    assert.equal(h.auth.state.message, 'Safe error');
    assert.equal(h.saved() === null, terminal);
    await h.auth.close();
  }
});

test('rotated credentials survive a failed disk write without reusing the old refresh token', async () => {
  let fail = true;
  const h = harness({ initial: credential(), save: async () => { if (fail) throw new OAuthFailure('Disk full'); } });
  await h.auth.initialize();
  await h.auth.refresh();
  assert.equal(h.auth.state.message, 'Disk full');
  fail = false;
  await h.auth.refresh();
  assert.equal(h.calls(), 1, 'retry persistence, not token rotation');
  assert.equal(h.saved().refresh, 'rotated');
  await h.auth.close();
});
