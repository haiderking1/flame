import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { CodexInferenceClient } from '../../dist/backend/turns/client.js';
import { rendererDriver } from '../helpers/rendererDriver.mjs';
import { captureUI } from '../helpers/captureUI.mjs';
import { chooseFirstModel } from '../helpers/modelPicker.mjs';
import { isTitleRequest, titleReply } from '../helpers/titleModel.mjs';

const events = items => [...items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })), { type: 'response.completed', response: { status: 'completed', output: [] } }]
  .map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const FIRST = 'Please fix the login redirect that loops forever after signing in with SSO';
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const userData = app.getPath('userData'), filename = join(userData, 'flame.sqlite'), projects = new ProjectStore(filename);
  const projectPath = join(userData, 'Project'); await mkdir(projectPath); await writeFile(join(projectPath, 'README.md'), '# Project\n');
  const project = projects.add(projectPath);
  const model = { slug: 'test-model', display_name: 'Test model', priority: 0, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }] };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [model] }));
  // Each title request waits until the test lets it answer, so the UI can be checked in between.
  const prompts = [], gates = [];
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (isTitleRequest(body)) {
      const prompt = body.input[0].content[0].text; prompts.push(prompt);
      await new Promise(resolve => gates.push(resolve));
      return prompt.startsWith('Regenerate') ? titleReply('SSO Login Loop After Sign-In') : titleReply('Fix SSO Login Redirect Loop');
    }
    return new Response(events([say('The redirect loops because the session cookie is set after the redirect.')]));
  });
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename, token: 'titles-token', origin: 'file://', openBrowser: async () => assert.fail('No sign-in in tests'), modelsClient, inferenceClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=titles-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait, click, set } = driver;
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const until = async (check, what) => { for (let i = 0; i < 500; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } assert.fail(`Timed out waiting for ${what}`); };
  const title = "(document.querySelector('.session-list__item[aria-current]')?.getAttribute('aria-label') ?? null)";
  const openMenu = async () => {
    await wait("document.querySelector('.session-list__item[aria-current] ~ .session-list__actions .session-list__options')?.disabled === false");
    await click('.session-list__item[aria-current] ~ .session-list__actions .session-list__options');
    await wait("!!document.querySelector('.session-menu')");
  };
  const menuItem = text => `[...document.querySelectorAll('.session-menu [role=menuitem]')].find(item => item.textContent === ${JSON.stringify(text)})`;
  try {
    if (await evaluate("document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === 'false'")) await click('.sidebar-toggle');
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait("document.querySelector('.composer__input').readOnly === false");
    await chooseFirstModel(driver);

    // The first message titles the thread at once; the text model's title replaces it.
    await set('.composer__input', FIRST);
    await evaluate("document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    await wait(`${title} === ${JSON.stringify(`${FIRST.slice(0, 50)}...`)}`);
    await until(() => gates.length === 1, 'the title request');
    assert.match(prompts[0], new RegExp(`User message:\\n${FIRST}$`));
    await captureUI(driver, 'title-seed');
    gates.shift()();
    await wait(`${title} === 'Fix SSO Login Redirect Loop'`);
    await wait("[...document.querySelectorAll('.session-history')].some(node => node.textContent.includes('session cookie'))");
    await wait("!document.querySelector('.composer [aria-label=\"Stop response\"]')");
    await captureUI(driver, 'title-generated');

    // "Regenerate title" retitles from the conversation; the row dims and the item waits until the model answers.
    await openMenu();
    assert.equal(await evaluate(`[...document.querySelectorAll('.session-menu [role=menuitem]')].map(item => item.textContent).slice(0, 2).join('|')`), 'Rename|Regenerate title');
    await evaluate(`${menuItem('Regenerate title')}.click()`);
    await wait("!document.querySelector('.session-menu')");
    await wait("document.querySelector('.session-list__item[aria-current]')?.getAttribute('aria-busy') === 'true'");
    await until(() => gates.length === 1, 'the regeneration request');
    assert.match(prompts[1], /^Regenerate the title for an existing Flame thread[\s\S]*The previous title was "Fix SSO Login Redirect Loop"\./);
    assert.match(prompts[1], /Thread contents:\nUSER:\nPlease fix the login redirect[\s\S]*\n\nASSISTANT:\nThe redirect loops because the session cookie is set after the redirect\.$/);
    await wait("getComputedStyle(document.querySelector('.session-list__item[aria-current] .session-list__title')).opacity === '0.55'");
    assert.equal(await evaluate("document.querySelector('.session-list__row [role=status]')?.textContent"), 'Regenerating title');
    await openMenu();
    assert.deepEqual(await evaluate(`(() => { const item = ${menuItem('Regenerating…')}; return item ? { disabled: item.disabled, dimmed: getComputedStyle(item).color !== getComputedStyle(${menuItem('Rename')}).color } : null; })()`), { disabled: true, dimmed: true });
    await captureUI(driver, 'title-regenerating');
    await evaluate("document.querySelector('.session-menu').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await wait("!document.querySelector('.session-menu')");
    gates.shift()();
    await wait(`${title} === 'SSO Login Loop After Sign-In' && !document.querySelector('.session-list__item[aria-current]').hasAttribute('aria-busy')`);
    assert.equal(await evaluate("document.querySelector('.session-list__row [role=status]')"), null);
    assert.equal(prompts.length, 2, 'no other title requests');
    await captureUI(driver, 'title-regenerated');
    assert.deepEqual(errors, []);
    console.log('FLAME_THREAD_TITLES_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'title-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
