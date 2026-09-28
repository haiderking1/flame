import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { checkFloatingComposer } from '../helpers/floatingComposer.mjs';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { CodexInferenceClient } from '../../dist/backend/turns/client.js';

// Keep Electron alive through asynchronous cleanup so assertions cannot turn
// into a successful exit merely because the test window was destroyed.
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const filename = join(app.getPath('userData'), 'flame.sqlite');
  const projects = new ProjectStore(filename);
  const a = projects.add(join(app.getPath('userData'), 'Project A'));
  const b = projects.add(join(app.getPath('userData'), 'Project B'));
  const repository = new SessionRepository(join(app.getPath('userData'), 'projects'), projects);
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: ['Alpha', 'Beta'].map((name, priority) => ({
    slug: name.toLowerCase(), display_name: name, priority, visibility: 'list', default_reasoning_level: 'high',
    supported_reasoning_levels: [{ effort: 'low', description: 'Less thinking' }, { effort: 'high', description: 'More thinking' }],
    service_tiers: [{ id: 'priority', name: 'Fast', description: 'Increased usage' }],
  })) }));
  let ready;
  const portReady = new Promise((resolve) => { ready = resolve; });
  const abort = new AbortController();
  let inferenceCalls = 0;
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    const call = ++inferenceCalls;
    const prompt = JSON.parse(options.body).input.at(-1).content[0].text;
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        const emit = (event) => { if (!cancelled) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); };
        const delta = (text) => emit({ type: 'response.output_text.delta', output_index: 0, delta: text });
        void (async () => {
          if (prompt === 'Stop this') { delta('Partial answer.\n\nUnfinished'); return; }
          const text = 'First paragraph.\n\nPending words continued.\n\n```ts\nconst value = 1;\n```\n';
          delta('First paragraph.\n\nPending words'); await delay(800);
          if (cancelled) return;
          delta(' continued.\n\n```ts\nconst value = 1;\n'); await delay(800);
          if (cancelled) return;
          delta('```\n');
          emit({ type: 'response.output_item.done', output_index: 0, item: { id: `msg_${call}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } });
          emit({ type: 'response.completed', response: { status: 'completed', output: [] } });
          controller.close();
        })().catch((error) => { if (!cancelled) controller.error(error); });
      },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: { 'content-type': 'application/octet-stream' } });
  });
  const running = Effect.runPromise(Effect.scoped(startServer({ filename, token: 'test-token', origin: 'file://', modelsClient, inferenceClient,
    openBrowser: async () => assert.fail('Session storage must not start OAuth'), ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady;
  ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=test-token`);
  const window = await createWindow();
  // Keep a desktop viewport across reloads and the app's restored zoom level.
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 2200, height: 1400, deviceScaleFactor: 1, mobile: false });
  const evaluate = (code) => window.webContents.executeJavaScript(code, true);
  const wait = async (code) => {
    for (let i = 0; i < 200; i++) { if (await evaluate(code)) return; await delay(20); }
    assert.fail(`Timed out: ${code}\n${await evaluate("document.body.innerText")}`);
  };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type = async (selector, value, replace = false) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    if (replace) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
    }
    if (value) await window.webContents.insertText(value);
  };
  const create = async (projectId) => {
    const count = repository.list().sessions.length;
    await wait("!document.querySelector('[aria-label=\"New thread\"]').disabled");
    await click('[aria-label="New thread"]');
    await wait("!!document.querySelector('.session-dialog[open] select')");
    await evaluate(`(() => { const select = document.querySelector('.session-dialog select'); select.value = ${JSON.stringify(projectId)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click('.session-dialog button[type=submit]');
    await wait("!document.querySelector('.session-dialog') && !!document.querySelector('.session-history:not([hidden])') && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    assert.equal(repository.list().sessions.length, count + 1);
    return repository.list().sessions.find((session) => session.title === 'New session' && session.projectId === projectId && session.sessionId !== sessionA?.sessionId);
  };
  const model = async (name) => {
    await click('.composer-settings__model');
    await wait("document.querySelector('.model-picker').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.model-picker__option')].find(option => option.querySelector('.model-picker__name').textContent === ${JSON.stringify(name)}).click()`);
    await wait(`!document.querySelector('.model-picker').matches(':popover-open') && document.querySelector('.composer-settings__label').textContent === ${JSON.stringify(name)}`);
  };
  let sessionA;
  try {
    await wait("document.querySelectorAll('.model-picker__option').length === 2 && !!document.querySelector('[aria-label=\"New thread\"]')");
    assert.equal(await evaluate("document.querySelector('textarea').readOnly"), true);
    sessionA = await create(a.id);
    await model('Alpha');
    await click('.composer-settings__thinking');
    await wait("document.querySelector('.thinking-picker').matches(':popover-open')");
    await click('.thinking-picker [role=menuitemradio]');
    await wait("!document.querySelector('.thinking-picker').matches(':popover-open') && document.querySelector('.composer-settings__thinking').textContent.includes('Low')");
    await click('.composer-settings__thinking');
    await wait("document.querySelector('.thinking-picker').matches(':popover-open')");
    await click('.thinking-picker__fast');
    await wait("!document.querySelector('.thinking-picker').matches(':popover-open') && document.querySelector('.composer-settings__thinking').textContent.includes('Fast')");
    await type('textarea', 'First draft');
    await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    assert.equal(repository.use(sessionA, (db) => db.read()).draft, 'First draft');
    const sessionB = await create(a.id);
    assert.equal(await evaluate("document.querySelector('textarea').value"), '');
    assert.equal(repository.use(sessionB, (db) => db.read()).settings, null, 'session choices do not leak into new sessions');
    await model('Beta');
    await type('textarea', 'Hello from B');
    await click('[aria-label="Send message"]');
    await wait("document.querySelector('.session-message p')?.textContent === 'Hello from B' && document.querySelector('textarea').value === ''");
    await wait("document.querySelector('.session-message--assistant p')?.textContent === 'First paragraph.\\n\\n'");
    assert.ok(!await evaluate("document.querySelector('.session-history').textContent.includes('Pending words')"));
    const resumed = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    window.webContents.reload(); await resumed;
    await wait("!!document.querySelector('.session-message--assistant')");
    assert.equal(inferenceCalls, 1, 'renderer reload resumes the active response without replay');
    await wait("document.querySelector('.session-message--assistant p')?.textContent.includes('Pending words continued.')");
    assert.ok(!await evaluate("document.querySelector('.session-history').textContent.includes('const value')"), 'an open code fence remains buffered');
    await wait("document.querySelector('.session-message--assistant p')?.textContent.includes('const value') && !document.querySelector('textarea').readOnly && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    assert.equal(repository.use(sessionB, (db) => db.history(null)).entries.filter((entry) => entry.kind === 'user').length, 1);
    assert.equal(repository.use(sessionB, (db) => db.turns.snapshot()).status, 'completed');
    assert.equal(await evaluate("document.querySelector('.session-message--assistant > span').textContent"), 'Flame', 'successful streamed replies must not show failed');
    await checkFloatingComposer({ evaluate, type, wait, resize: (width) => window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height: 1400, deviceScaleFactor: 1, mobile: false }) });
    assert.ok(await evaluate("!document.querySelector('.session-heading') && !document.querySelector('.workspace__chat h1')"), 'the session header is removed');
    assert.ok(await evaluate("!document.querySelector('.session-history').textContent.includes('Model settings:')"), 'settings events never appear as messages');
    assert.ok(repository.use(sessionB, (db) => db.history(null)).entries.some((entry) => entry.kind === 'settings'), 'settings remain durable internally');
    await evaluate("[...document.querySelectorAll('.session-list__item')].find(button => button.querySelector('.session-list__title').textContent === 'New session').click()");
    await wait("document.querySelector('textarea').value === 'First draft' && document.querySelector('.composer-settings__label').textContent === 'Alpha'");
    assert.ok(await evaluate("document.querySelector('.composer-settings__thinking').textContent.includes('Low') && document.querySelector('.composer-settings__thinking').textContent.includes('Fast')"));
    await click('[aria-label="Send message"]');
    await wait("document.querySelector('.session-message p')?.textContent === 'First draft'");
    await wait("!!document.querySelector('.session-message--assistant') && !!document.querySelector('[aria-label=\"Send message\"]') && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    await type('[aria-label="Search threads"]', 'Hello from B');
    await wait("document.querySelectorAll('.session-list__item').length === 1");
    await type('[aria-label="Search threads"]', '', true);
    await wait("document.querySelectorAll('.session-list__item').length === 2");
    await type('textarea', 'A pending draft');
    await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    const reloaded = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    window.webContents.reload(); await reloaded;
    await wait("document.querySelector('textarea')?.value === 'A pending draft' && document.querySelector('.composer-settings__label')?.textContent === 'Alpha'");
    assert.equal(await evaluate("document.querySelector('.session-message p').textContent"), 'First draft');
    assert.equal(repository.use(sessionB, (db) => db.read()).settings.modelId, 'beta');
    await type('textarea', 'Stop this', true);
    await click('[aria-label="Send message"]');
    await wait("!!document.querySelector('.composer-actions__send[aria-label=\"Stop response\"]')");
    await click('.composer-actions__send[aria-label="Stop response"]');
    await wait("document.querySelector('.session-history').textContent.includes('Response stopped') && !document.querySelector('textarea').readOnly");
    assert.equal(repository.use(sessionA, (db) => db.turns.snapshot()).status, 'cancelled');
    repository.use(sessionA, (db) => db.draft(db.read().revision, 'Remote draft'));
    await type('textarea', 'Local draft', true);
    await wait("document.querySelector('.session-error')?.textContent.includes('changed elsewhere')");
    assert.equal(await evaluate("document.querySelector('textarea').value"), 'Local draft');
    assert.equal(repository.use(sessionA, (db) => db.read()).draft, 'Remote draft');
    await evaluate("[...document.querySelectorAll('.session-error button')].find(button => button.textContent === 'Reload saved state').click()");
    await wait("document.querySelector('.session-error')?.textContent.includes('Saved state reloaded')");
    assert.equal(await evaluate("document.querySelector('textarea').value"), 'Local draft');
    await evaluate("[...document.querySelectorAll('.session-error button')].find(button => button.textContent === 'Retry save').click()");
    await wait("!document.querySelector('.session-error') && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    assert.equal(repository.use(sessionA, (db) => db.read()).draft, 'Local draft');
    assert.equal(repository.list().sessions.length, 2);
    const sessionC = await create(b.id);
    assert.equal(sessionC.projectId, b.id);
    assert.equal(repository.list().warnings.length, 0);
    assert.ok(await evaluate("!document.body.textContent.includes('Saved locally') && !document.body.textContent.includes('Tools are not connected')"));
  } finally { window.destroy(); abort.abort(); await running; projects.close(); }
  console.log('FLAME_SESSION_UI_OK');
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
