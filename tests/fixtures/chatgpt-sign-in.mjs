import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { chatgptSignIn, ChatGPTTokens } from '../../dist/backend/auth/chatgpt/protocol.js';
import { OpenAIKeys } from '../../dist/backend/auth/chatgpt/id-token.js';
import { allowedOAuthUrl } from '../../dist/main/oauthBrowser.js';
import { rendererDriver } from '../helpers/rendererDriver.mjs';
import { captureUI } from '../helpers/captureUI.mjs';
import { fakeOpenAIAuth } from '../helpers/chatgptAuth.mjs';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const fake = fakeOpenAIAuth();
  const opened = [];
  const authMethods = { chatgpt: chatgptSignIn(new ChatGPTTokens(fake.fetch, new OpenAIKeys(fake.fetch))) };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [{ slug: 'plan-model', display_name: 'Plan model', visibility: 'list' }] }));
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename: join(app.getPath('userData'), 'flame.sqlite'), token: 'sign-in-token', origin: 'file://',
    // The browser is not opened: the test answers the sign-in itself, after checking the waiting state.
    openBrowser: async url => { assert.ok(allowedOAuthUrl(url)); opened.push(new URL(url)); }, authMethods, modelsClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=sign-in-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait } = driver;
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const status = "(document.querySelector('#chatgpt-auth-status')?.textContent ?? null)";
  const buttons = method => `[...document.querySelectorAll('[data-method=${method}] .provider-row__actions button')].map(button => button.textContent || button.getAttribute('aria-label'))`;
  const nav = label => evaluate(`[...document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
  try {
    await wait("document.querySelector('.sidebar-footer button') !== null");
    await evaluate("document.querySelector('.sidebar-footer button').click()");
    await wait("document.querySelector('[data-method=chatgpt] .provider-row__sign-in')?.disabled === false");

    // Signed out: a compact row for each sign-in, ChatGPT tagged official first, Codex tagged legacy, no status and no switch.
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.provider-row h2')].map(heading => heading.textContent)"), ['ChatGPT official', 'Codex legacy']);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.provider-row__sign-in')].map(button => button.getAttribute('aria-label'))"), ['Sign in with ChatGPT', 'Sign in with Codex']);
    assert.deepEqual([await evaluate(buttons('chatgpt')), await evaluate(buttons('codex'))], [['Sign in'], ['Sign in']]);
    assert.equal(await evaluate("document.querySelector('.provider-row p, .provider-row__switch')"), null);
    await captureUI(driver, 'providers-signed-out');

    await evaluate("document.querySelector('[data-method=chatgpt] .provider-row__sign-in').click()");
    await wait(`${status} === 'Finish sign-in in your browser'`);
    await wait(`JSON.stringify(${buttons('chatgpt')}) === '["Cancel"]'`);
    assert.equal(await evaluate("document.querySelector('[data-method=codex] .provider-row__sign-in').disabled"), true, 'one sign-in at a time');
    for (let i = 0; i < 200 && !opened.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    const authorize = opened[0];
    assert.equal(authorize.pathname, '/api/accounts/authorize');
    assert.equal(authorize.searchParams.get('agent_name_hint'), 'Flame');
    await captureUI(driver, 'providers-authorizing');

    // OpenAI sends the browser back to Flame with the client it registered.
    fake.nonce = authorize.searchParams.get('nonce');
    const redirect = new URL(authorize.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({ code: 'browser-code', state: authorize.searchParams.get('state'), client_id: 'oaiapp_flame_ui', scope: fake.scope }).toString();
    assert.equal((await fetch(redirect)).status, 200);
    await wait(`${status}?.startsWith('Connected · ')`);
    assert.equal(await evaluate("document.querySelector('[data-method=chatgpt] .provider-row__switch')?.getAttribute('aria-checked')"), 'true');
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.provider-connection-status')].map(dot => dot.getAttribute('aria-label'))"), ['Connected', 'Not connected']);
    assert.equal(await evaluate("document.querySelector('[data-method=codex] .provider-row__sign-in').title"), 'Replaces your current sign-in');
    const stored = JSON.parse(await readFile(join(homedir(), '.flame', 'agent', 'auth.json'), 'utf8'));
    assert.equal(stored['openai-chatgpt'].clientId, 'oaiapp_flame_ui');
    assert.equal(fake.requests.at(-1).body.client_id, 'oaiapp_flame_ui');
    await captureUI(driver, 'providers-chatgpt');

    // ChatGPT keeps the plan's usage; Flame links there instead of reading it.
    await nav('Usage');
    await wait("document.querySelector('#usage-chatgpt-heading')?.textContent === 'ChatGPT plan'");
    assert.equal(await evaluate("document.querySelector('.usage-card__header button').textContent"), 'Manage usage');
    assert.equal(await evaluate("document.querySelector('.usage-meter')"), null);
    assert.equal(await evaluate("document.querySelector('.usage-settings [role=alert]')"), null);
    await captureUI(driver, 'usage-chatgpt');

    // Signing out offers both sign-ins again and keeps only the installation's host ID.
    await nav('Providers');
    await wait("document.querySelector('.provider-row__switch')?.disabled === false");
    await evaluate("document.querySelector('[aria-label=\"Sign out of ChatGPT\"]').click()");
    await wait("document.querySelector('[data-method=chatgpt] .provider-row__sign-in')?.disabled === false");
    assert.equal(await evaluate(status), null);
    assert.deepEqual(Object.keys(JSON.parse(await readFile(join(homedir(), '.flame', 'agent', 'auth.json'), 'utf8'))), ['openai-agent-host']);
    assert.deepEqual(errors, []);
    console.log('FLAME_CHATGPT_SIGN_IN_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'chatgpt-sign-in-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
