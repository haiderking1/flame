import assert from 'node:assert/strict';
import { app, ipcMain, shell } from 'electron';
import { checkEmptyChat } from '../helpers/emptyChat.mjs';
import { checkSettlement } from '../helpers/settlement.mjs';
import { checkSessionSidebar } from '../helpers/sessionSidebar.mjs';
import { markdownSample, checkMarkdown } from '../helpers/markdown.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  mkdirSync(a.path, { recursive: true }); mkdirSync(b.path, { recursive: true });
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
    const input = JSON.parse(options.body).input;
    const prompt = [...input].reverse().find(item => item.role === 'user')?.content?.[0]?.text;
    if ((prompt === 'Hello from B' && !input.some(item => item.type === 'function_call_output')) || prompt === 'Stop this') {
      const command = prompt === 'Stop this' ? 'printf bash-running; sleep 60' : 'printf x >> flame-ui-marker; printf bash-ui-output';
      const item = { type: 'function_call', name: 'bash', call_id: `ui_bash_${call}`, arguments: JSON.stringify({ command, background: false }) };
      const commentary = { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Checking the project before answering.' }] };
      return new Response([ { type: 'response.output_item.done', output_index: 0, item: commentary },
        { type: 'response.output_item.done', output_index: 1, item },
        { type: 'response.completed', response: { status: 'completed', output: [] } }
      ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    }
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        const emit = (event) => { if (!cancelled) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); };
        const delta = (text) => emit({ type: 'response.output_text.delta', output_index: 0, delta: text });
        void (async () => {
          if (prompt === 'Stop this') { delta('Partial answer.\n\nUnfinished'); return; }
          const text = 'First paragraph.\n\nPending words continued.\n\n```ts\nconst value = 1;\n```\n' + markdownSample;
          delta('First paragraph.\n\nPending words'); await delay(800);
          if (cancelled) return;
          delta(' continued.\n\n```ts\nconst value = 1;\n'); await delay(800);
          if (cancelled) return;
          delta('```\n' + markdownSample);
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
  const pointerClick = async selector => {
    const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.scrollIntoView({block:'nearest'}); const box = element.getBoundingClientRect(); return {x:box.left + box.width / 2, y:box.top + box.height / 2}; })()`);
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  const type = async (selector, value, replace = false) => {
    window.focus(); window.webContents.focus();
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    if (replace) {
      await evaluate(`window.flameClearFinished = false; document.querySelector(${JSON.stringify(selector)}).addEventListener('keyup', function cleared(event) { if (event.key === 'Backspace') { window.flameClearFinished = true; this.removeEventListener('keyup', cleared); } }); true`);
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
      await wait(`window.flameClearFinished && document.querySelector(${JSON.stringify(selector)}).value === ''`);
    }
    if (value) await window.webContents.insertText(value);
  };
  const create = async (projectId) => {
    const count = repository.list().sessions.length;
    await wait("!document.querySelector('[aria-label=\"New thread\"]').disabled");
    await click('[aria-label="New thread"]');
    await wait("!!document.querySelector('.new-session-dialog[open] [role=option]')");
    await click(`.new-session-dialog [role=option][id$="-${projectId}"]`);
    await wait("!document.querySelector('.new-session-dialog') && document.querySelector('textarea')?.readOnly === false && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
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
    await checkEmptyChat(evaluate);
    sessionA = await create(a.id);
    await checkEmptyChat(evaluate);
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
    await checkEmptyChat(evaluate);
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      mkdirSync(process.env.FLAME_UI_CAPTURE_DIR, { recursive: true });
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'empty-chat.png'), (await window.webContents.capturePage()).toPNG());
    }
    const sessionB = await create(a.id);
    assert.equal(await evaluate("document.querySelector('textarea').value"), '');
    assert.equal(repository.use(sessionB, (db) => db.read()).settings, null, 'session choices do not leak into new sessions');
    await model('Beta');
    await type('textarea', 'Hello from B');
    await click('[aria-label="Send message"]');
    await wait("document.querySelector('.session-message p')?.textContent === 'Hello from B' && document.querySelector('textarea').value === ''");
    assert.equal(await evaluate("!!document.querySelector('.session-empty__heading')"), false, 'first message removes the empty heading');
    await wait("[...document.querySelectorAll('.work-group__commentary')].at(-1)?.textContent.trim() === 'First paragraph.'");
    assert.ok(!await evaluate("document.querySelector('.session-history').textContent.includes('Pending words')"));
    const resumed = new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    window.webContents.reload(); await resumed;
    await wait("!!document.querySelector('.work-group__commentary')");
    assert.equal(await evaluate("!!document.querySelector('.session-empty__heading')"), false, 'existing conversation stays docked after reload');
    assert.equal(inferenceCalls, 2, 'renderer reload resumes the active response without replay');
    await wait("document.querySelector('.work-group__heading')?.textContent.includes('Ran command')");
    assert.equal(readFileSync(join(a.path, 'flame-ui-marker'), 'utf8'), 'x');
    await wait("[...document.querySelectorAll('.work-group__commentary')].some(node => node.textContent.includes('Pending words continued.'))");
    assert.ok(!await evaluate("document.querySelector('.session-history').textContent.includes('const value')"), 'an open code fence remains buffered');
    await wait("document.querySelector('.session-message--assistant .markdown-code pre')?.textContent.includes('const value') && !document.querySelector('textarea').readOnly && document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    await wait("document.querySelector('.work-group__heading')?.getAttribute('aria-expanded') === 'false'");
    assert.equal(await evaluate("document.querySelectorAll('.work-group').length"), 1, 'work stays in its response instead of a separate job list');
    assert.ok(!await evaluate("document.querySelector('.session-message--assistant p').textContent.includes('Checking the project')"), 'commentary is not duplicated into the final answer');
    await click('.work-group__heading');
    assert.ok(await evaluate("document.querySelector('.work-group__steps').firstElementChild.textContent.includes('Checking the project')"), 'narration precedes its tool call');
    await click('.work-tool__toggle');
    await wait("document.querySelector('.work-tool__output')?.textContent.includes('bash-ui-output')");
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      await delay(150); // Let the compositor paint the expanded state before capture.
      mkdirSync(process.env.FLAME_UI_CAPTURE_DIR, { recursive: true });
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'work-expanded.png'), (await window.webContents.capturePage()).toPNG());
    }
    await click('.work-group__heading');
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      await delay(150);
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'work-collapsed.png'), (await window.webContents.capturePage()).toPNG());
    }
    assert.equal(repository.use(sessionB, (db) => db.history(null)).entries.filter((entry) => entry.kind === 'user').length, 1);
    assert.equal(repository.use(sessionB, (db) => db.turns.snapshot()).status, 'completed');
    assert.ok(await evaluate("document.querySelector('.session-message--assistant').getAttribute('aria-label') === 'Flame' && !document.querySelector('.session-message--assistant > span, .session-message--user > span')"), 'authors are accessible without visible role headers');
    assert.ok(await evaluate("(() => { const bubble = document.querySelector('.session-message--user').getBoundingClientRect(); const column = document.querySelector('.session-history__content').getBoundingClientRect(); return Math.abs(bubble.right - column.right) < 1 && bubble.width <= column.width * .8 + 1; })()"), 'user bubbles fit their content on the right');
    await checkMarkdown({ evaluate, wait, click });
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      await evaluate("document.querySelector('.session-history').scrollTop = 0");
      await delay(150);
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'markdown.png'), (await window.webContents.capturePage()).toPNG());
    }
    const openExternal = shell.openExternal, opened = [];
    shell.openExternal = async url => { opened.push(url); };
    try {
      await click('.markdown a[href="https://example.com/docs"]');
      for (let i = 0; !opened.length && i < 50; i++) await delay(20);
      assert.deepEqual(opened, ['https://example.com/docs']);
      await evaluate("window.open('file:///etc/passwd'); window.open('javascript:void(0)')");
      await delay(50);
      assert.equal(opened.length, 1, 'only web links can leave the app');
    } finally { shell.openExternal = openExternal; }
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
    assert.ok(await evaluate("document.querySelector('.markdown h2')?.textContent === 'Summary' && document.querySelector('.markdown-code pre')?.textContent.includes('const value')"), 'saved answers keep Markdown after reload');
    assert.equal(repository.use(sessionB, (db) => db.read()).settings.modelId, 'beta');
    await type('textarea', 'Stop this', true);
    await click('[aria-label="Send message"]');
    await wait("!!document.querySelector('.composer-actions__send[aria-label=\"Stop response\"]')");
    await wait("!!document.querySelector('.work-tools[data-running=true]')");
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
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      await wait("!document.querySelector('[aria-label=\"Options for First draft\"]').disabled");
      await evaluate("document.querySelector('[aria-label=\"Options for First draft\"]').click()");
      await wait("!!document.querySelector('.session-menu')");
      await delay(150);
      assert.ok(await evaluate("!!document.querySelector('.session-menu')"), 'thread menu remains open');
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'session-sidebar.png'), (await window.webContents.capturePage()).toPNG());
      await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))");
    }
    await checkSettlement({ evaluate, wait, click, type, repository, active: sessionC, inactive: sessionB,
      reload: async () => { const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve)); window.webContents.reload(); await loaded; } });
    await checkSessionSidebar({ evaluate, wait, click, pointerClick, type, repository, active: sessionC, inactive: sessionB });
    assert.equal(repository.list().warnings.length, 0);
    assert.ok(await evaluate("!document.body.textContent.includes('Saved locally') && !document.body.textContent.includes('Tools are not connected')"));
  } finally { window.destroy(); abort.abort(); await running; projects.close(); }
  console.log('FLAME_SESSION_UI_OK');
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
