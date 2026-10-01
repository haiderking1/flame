import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { checkSlashCommandStyle } from '../helpers/slashCommands.mjs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, ipcMain, session } from 'electron';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { installImageUploadOrigin } from '../../dist/main/imageUploadOrigin.js';
import { startServer } from '../../dist/backend/server.js';
import { isTitleRun, titleResult } from '../helpers/titleModel.mjs';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { InferenceFailure } from '../../dist/backend/turns/client.js';
import { png } from '../helpers/images.mjs';

app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const filename = join(app.getPath('userData'), 'flame.sqlite');
  const projects = new ProjectStore(filename);
  const project = projects.add(join(app.getPath('userData'), 'Project'));
  mkdirSync(project.path, { recursive: true });
  const repository = new SessionRepository(join(app.getPath('userData'), 'projects'), projects);
  const location = { projectId: project.id, sessionId: randomUUID() };
  const settings = { modelId: 'alpha', effort: null, serviceTier: 'default' };
  repository.create(location, settings);
  repository.use(location, db => {
    for (let i = 0; i < 12; i++) db.append(db.read().revision, randomUUID(), `Record ${i}: ${'project context '.repeat(1100)}`);
    db.rename(db.read().revision, 'Compaction test');
  });
  const initialEntries = repository.use(location, db => db.history(null).entries.map(entry => entry.id));
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [{
    slug: 'alpha', display_name: 'Alpha', priority: 0, visibility: 'list', context_window: 100_000,
    default_reasoning_level: null, supported_reasoning_levels: [],
  }] }));
  const summary = '## Goal\nKeep building the project.\n## Progress\nEarlier project records were reviewed.\n## Next Steps\nContinue with the latest user request.';
  const keptDraft = 'Do not lose this draft; typed during compaction';
  const result = text => ({ text, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
  let summaryCalls = 0, answerCalls = 0;
  const inferenceClient = { async run(request, onText, signal) {
    if (isTitleRun(request)) return titleResult();
    if (request.instructionsOverride?.includes('context checkpoint')) {
      summaryCalls++;
      assert.equal(request.tools, false, 'summary generation has no tools');
      if (summaryCalls === 1) {
        await new Promise((resolve, reject) => {
          const cancel = () => reject(signal.reason);
          if (signal.aborted) cancel(); else signal.addEventListener('abort', cancel, { once: true });
        });
      }
      if (summaryCalls === 2) throw new InferenceFailure('Summary service unavailable. Your history was preserved.');
      await delay(120);
      return result(summary);
    }
    answerCalls++;
    assert.ok(JSON.stringify(request.input).includes('Earlier project records were reviewed.'), 'next turn receives checkpoint');
    onText('Continuing from the summary.');
    return result('Continuing from the summary.');
  } };
  let ready;
  const portReady = new Promise(resolve => { ready = resolve; });
  const abort = new AbortController();
  const server = Effect.runPromise(Effect.scoped(startServer({ filename, token: 'test-token', origin: 'file://', modelsClient, inferenceClient,
    openBrowser: async () => assert.fail('Compaction must not request OAuth'), ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady;
  ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=test-token`);
  installImageUploadOrigin(session.defaultSession, `ws://127.0.0.1:${port}/rpc?token=test-token`);
  const window = await createWindow();
  const evaluate = async code => {
    try { return await window.webContents.executeJavaScript(code, true); }
    catch (error) { throw new Error(`Renderer evaluation failed: ${code}`, { cause: error }); }
  };
  const wait = async code => {
    for (let i = 0; i < 250; i++) { if (await evaluate(code)) return; await delay(20); }
    assert.fail(`Timed out: ${code}\n${await evaluate("JSON.stringify({draft:document.querySelector('.composer__input')?.value,focus:document.activeElement?.tagName,readonly:document.querySelector('.composer__input')?.readOnly,hint:document.querySelector('.composer__hint')?.textContent,status:document.querySelector('.turn-feedback')?.textContent})")}`);
  };
  // Like a user, a click waits for its control to be there and enabled; clicking a disabled one does nothing.
  const click = async (selector) => { await wait(`document.querySelector(${JSON.stringify(selector)})?.matches(':disabled') === false`); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); };
  const reload = async () => {
    const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    window.webContents.reload(); await loaded;
  };
  const press = async (keyCode, modifiers = []) => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode === 'Enter' && modifiers.includes('shift')) window.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await evaluate('new Promise(resolve => requestAnimationFrame(resolve))');
  };
  const type = async value => {
    window.focus(); window.webContents.focus();
    // A run ending reloads the session, briefly making the composer read-only; focus it once it can take text.
    await wait("(() => { const input = document.querySelector('.composer__input'); if (!input || input.readOnly) return false; input.focus(); return document.activeElement === input; })()");
    await press('A', ['control']); await press('Backspace');
    await wait("document.querySelector('.composer__input').value === ''");
    if (value) await window.webContents.insertText(value);
    await wait(`document.querySelector('.composer__input').value === ${JSON.stringify(value)}`);
  };
  const entries = () => repository.use(location, db => db.history(null).entries);
  const noSlashEntries = () => assert.ok(entries().every(entry => !/^\/(?:compact|comp|wat)?$/i.test(entry.text ?? '')), 'slash commands never become user messages');
  const attachmentScope = `${location.projectId}:${location.sessionId}`;
  const attachmentId = randomUUID();
  const imageDraft = async write => evaluate(`new Promise((resolve, reject) => {
    const request = indexedDB.open('flame-image-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('drafts', ${JSON.stringify(write ? 'readwrite' : 'readonly')});
      const store = transaction.objectStore('drafts');
      ${write ? `store.put([{id:${JSON.stringify(attachmentId)},name:'pending.png',file:new Blob([Uint8Array.from(atob(${JSON.stringify(png(1, 1).toString('base64'))}), c => c.charCodeAt(0))], {type:'image/png'})}], ${JSON.stringify(attachmentScope)});` : ''}
      const read = store.get(${JSON.stringify(attachmentScope)});
      transaction.oncomplete = () => { const rows=read.result ?? []; db.close(); resolve(rows.map(image => ({id:image.id,name:image.name,size:image.file.size,type:image.file.type}))); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  })`);
  try {
    await wait("!![...document.querySelectorAll('.session-list__item')].find(node => node.textContent.includes('Compaction test'))");
    await evaluate("[...document.querySelectorAll('.session-list__item')].find(node => node.textContent.includes('Compaction test')).click()");
    await wait("!!document.querySelector('[aria-label=\"Estimated context usage\"]') && document.querySelector('.composer__input')?.readOnly === false");
    assert.equal(await evaluate("!!document.querySelector('.context-status') || !!document.querySelector('[aria-label=\"Compact conversation\"]')"), false, 'bottom row and manual button removed');
    const geometry = await evaluate(`(() => {
      const actions=document.querySelector('.composer-actions');
      const meter=actions.querySelector('[aria-label="Estimated context usage"]');
      const attach=actions.querySelector('[aria-label="Attach media"]');
      const send=actions.querySelector('.composer-actions__send');
      const box=meter.getBoundingClientRect(), sendBox=send.getBoundingClientRect();
      return {width:box.width,height:box.height,sendWidth:sendBox.width,sendHeight:sendBox.height,radius:getComputedStyle(meter).borderRadius,order:attach.compareDocumentPosition(meter),sendOrder:meter.compareDocumentPosition(send)};
    })()`);
    assert.ok(Math.abs(geometry.width - 32) < 1 && Math.abs(geometry.height - 32) < 1, 'context circle is 32 by 32');
    assert.ok(Math.abs(geometry.width - geometry.sendWidth) < 1 && Math.abs(geometry.height - geometry.sendHeight) < 1, 'context circle matches send geometry');
    assert.ok(geometry.radius === '50%' || parseFloat(geometry.radius) >= 16, 'context meter is circular');
    assert.ok((geometry.order & 4) && (geometry.sendOrder & 4), 'right actions order is attach, context, send');
    const attachment = await imageDraft(true);
    await type('/');
    await wait("!!document.querySelector('[role=listbox][aria-label=\"Slash commands\"]')");
    assert.ok(await evaluate("document.querySelector('[role=listbox][aria-label=\"Slash commands\"] [role=option]')?.textContent.includes('/compact')"));
    await checkSlashCommandStyle(evaluate);
    await evaluate(`(() => {
      const row = document.querySelector('.slash-commands__option');
      window.slashTextChanges = [row.textContent];
      window.slashTextObserver = new MutationObserver(() => {
        if (window.slashTextChanges.at(-1) !== row.textContent) window.slashTextChanges.push(row.textContent);
      });
      window.slashTextObserver.observe(row, {childList:true,characterData:true,subtree:true});
    })()`);
    for (let i = 0; i < 100 && repository.use(location, db => db.read().draft) !== '/'; i++) await delay(20);
    assert.equal(repository.use(location, db => db.read().draft), '/', 'slash draft autosaved while the list stayed open');
    await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    assert.equal(await evaluate('window.slashTextChanges.length'), 1, 'autosave never replaces command text or description');
    await evaluate('window.slashTextObserver.disconnect()');
    if (process.env.FLAME_UI_CAPTURE_DIR) {
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      mkdirSync(process.env.FLAME_UI_CAPTURE_DIR, { recursive: true });
      writeFileSync(join(process.env.FLAME_UI_CAPTURE_DIR, 'slash-commands.png'), (await window.webContents.capturePage()).toPNG());
    }
    await press('Escape');
    await wait("!document.querySelector('[role=listbox][aria-label=\"Slash commands\"]')");
    assert.equal(await evaluate("document.querySelector('.composer__input').value"), '/');
    await type('/comp');
    await wait("!!document.querySelector('[role=listbox][aria-label=\"Slash commands\"]')");
    await press('Tab');
    await wait("document.querySelector('.composer__input').value === '/compact'");
    assert.equal(await evaluate("document.activeElement === document.querySelector('.composer__input')"), true, 'Tab completes without leaving textarea');
    await evaluate("document.querySelector('.composer__input').dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true})); document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true,isComposing:true})); document.querySelector('.composer__input').dispatchEvent(new CompositionEvent('compositionend', {bubbles:true}));");
    assert.equal(summaryCalls, 0, 'IME Enter never invokes compaction');
    await press('Enter', ['shift']);
    await wait("document.querySelector('.composer__input').value.includes('\\n')");
    assert.equal(summaryCalls, 0, 'Shift+Enter inserts a newline without invoking command');
    await type('/wat');
    await press('Enter');
    await wait("document.querySelector('.composer__hint')?.textContent.includes('No matching slash command.')");
    assert.equal(await evaluate("document.querySelector('.composer__input').value"), '/wat', 'unknown slash command remains editable');
    assert.equal(answerCalls, 0); assert.equal(summaryCalls, 0); noSlashEntries();
    await type('/com');
    await press('ArrowDown');
    await press('ArrowUp');
    assert.ok(await evaluate("document.querySelector('[role=listbox][aria-label=\"Slash commands\"] [role=option][aria-selected=true]').textContent.includes('/compact')"));
    await press('Escape');
    await press('Enter');
    await wait("!!document.querySelector('[aria-label=\"Stop compaction\"]') && document.querySelector('.session-history').textContent.includes('Compacting conversation')");
    // The summary request reaches the model just after the UI shows compaction started; wait for it, then expect exactly one.
    for (let i = 0; i < 250 && summaryCalls === 0; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(summaryCalls, 1, 'one Enter executes partially typed command even with dismissed list');
    await wait("document.querySelector('.composer__input').value === ''");
    assert.equal(await evaluate("document.querySelector('.composer-settings__model').getAttribute('aria-busy')"), 'true');
    await click('.composer-settings__model');
    assert.equal(await evaluate("document.querySelector('.model-picker').matches(':popover-open')"), false);
    await type('Do not lose this draft');
    await window.webContents.insertText('; typed during compaction');
    await wait(`document.querySelector('.composer__input').value === ${JSON.stringify(keptDraft)} && document.querySelector('.workspace__composer').dataset.saveState === 'saved'`);
    await click('[aria-label="Stop compaction"]');
    await wait("!!document.querySelector('[aria-label=\"Send message\"]')");
    assert.equal(repository.use(location, db => db.compactions.list().length), 0, 'cancelled compaction saves no checkpoint');
    assert.deepEqual(entries().map(entry => entry.id), initialEntries, 'manual cancellation adds no messages');
    assert.equal(await evaluate("document.querySelector('.composer__input').value"), keptDraft);
    assert.deepEqual(await imageDraft(false), attachment, 'cancelled command preserves pending attachment');
    await type('/comp');
    await press('Tab');
    await wait("document.querySelector('.composer__input').value === '/compact'");
    await press('Enter');
    await wait("document.querySelector('.turn-feedback')?.textContent.includes('Summary service unavailable')");
    assert.equal(repository.use(location, db => db.compactions.list().length), 0);
    assert.equal(await evaluate("document.querySelector('.composer__input').value"), '', 'accepted failed summary consumes only command draft');
    assert.deepEqual(await imageDraft(false), attachment, 'failed summary preserves pending attachment');
    await type('/');
    await press('Enter');
    await wait("document.querySelectorAll('.compaction-marker').length === 1 && !!document.querySelector('[aria-label=\"Send message\"]')");
    assert.equal(summaryCalls, 3, 'cancel, failure, and retry issue one summary request each');
    assert.deepEqual(entries().map(entry => entry.id), initialEntries, 'successful manual compaction keeps full transcript');
    assert.deepEqual(await imageDraft(false), attachment, 'successful command preserves pending attachment');
    noSlashEntries();
    await type(keptDraft);
    await wait("document.querySelector('.workspace__composer').dataset.saveState === 'saved'");
    assert.equal(repository.use(location, db => db.read()).draft, keptDraft);
    await click('.compaction-marker > summary');
    assert.ok(await evaluate("document.querySelector('.compaction-marker').textContent.includes('Summaries can omit details')"));
    assert.ok(await evaluate("document.querySelector('.compaction-marker .markdown').textContent.includes('Earlier project records were reviewed')"));
    assert.ok(await evaluate("document.querySelector('[aria-label=\"Estimated context usage\"]')?.getAttribute('aria-valuetext').includes('(90%)')"));
    await reload();
    await wait(`document.querySelectorAll('.compaction-marker').length === 1 && document.querySelector('.composer__input')?.value === ${JSON.stringify(keptDraft)}`);
    await wait("document.querySelector('.image-gallery--draft .image-thumbnail img')?.naturalWidth > 0");
    await click('[aria-label="Send message"]');
    await wait("document.querySelector('.session-message--assistant')?.textContent.includes('Continuing from the summary') && !!document.querySelector('[aria-label=\"Send message\"]')");
    assert.equal(answerCalls, 1);
    assert.equal(await evaluate("document.querySelectorAll('.compaction-marker').length"), 1, 'checkpoint marker is not duplicated by turn reload');
    await type('/tmp/project.txt');
    assert.equal(await evaluate("!!document.querySelector('[role=listbox][aria-label=\"Slash commands\"]')"), false, 'file paths are ordinary message text');
    await press('Enter');
    await wait("document.querySelectorAll('.session-message--assistant').length === 2 && !!document.querySelector('[aria-label=\"Send message\"]')");
    assert.equal(answerCalls, 2, 'leading slash file path reaches inference as ordinary text');
    assert.ok(entries().some(entry => entry.kind === 'user' && entry.text === '/tmp/project.txt'));
    assert.equal(summaryCalls, 3); noSlashEntries();
    console.log('FLAME_COMPACTION_UI_OK');
  } finally { window.destroy(); abort.abort(); await server; projects.close(); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
