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
import { chooseOption, chosenOption } from '../helpers/selectMenu.mjs';
import { isTitleRequest, titleReply } from '../helpers/titleModel.mjs';

const events = items => [...items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })), { type: 'response.completed', response: { status: 'completed', output: [] } }]
  .map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const bash = (command, id) => ({ type: 'function_call', id: `fc_${id}`, call_id: id, name: 'bash', arguments: JSON.stringify({ command, background: false }) });
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const userData = app.getPath('userData'), filename = join(userData, 'flame.sqlite'), projects = new ProjectStore(filename);
  const projectPath = join(userData, 'Project'); await mkdir(projectPath); await writeFile(join(projectPath, 'README.md'), '# Project\n');
  const project = projects.add(projectPath);
  const model = { slug: 'test-model', display_name: 'Test model', priority: 0, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }] };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [model] }));
  const asked = [];
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (isTitleRequest(body)) return titleReply();
    const users = body.input.filter(item => item.role === 'user' && !JSON.stringify(item).includes('Saved'));
    const last = users.at(-1)?.content?.find(part => part.type === 'input_text')?.text ?? '';
    const answered = body.input.some(item => item.type === 'function_call_output' && item.call_id === `call-${asked.length}`);
    asked.push(last);
    if (/^Run the build/.test(last) && !answered) return new Response(events([bash('sleep 1.2; printf built', `call-${asked.length}`)]));
    if (/^Wait here/.test(last)) {
      // Holds until stopped, like a long answer.
      await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }
    return new Response(events([say(`Answered: ${last}`)]));
  });
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename, token: 'follow-token', origin: 'file://', openBrowser: async () => assert.fail('No sign-in in tests'), modelsClient, inferenceClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=follow-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait, click } = driver;
  // Typing waits for the editor's input event; report where it stalls instead of hanging.
  const set = async (selector, value) => {
    console.log('STEP set', value);
    // A run ending reloads the session, briefly making the composer read-only; type again once it is editable.
    for (let attempt = 1; ; attempt++) {
      await wait(`document.querySelector(${JSON.stringify(selector)})?.readOnly === false`);
      try { return await Promise.race([driver.set(selector, value), new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`Typing "${value}" stalled`)), 8000))]); }
      catch (error) { if (attempt >= 3) throw error; await driver.settle(); }
    }
  };
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const enter = (modifiers = {}) => evaluate(`document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ctrlKey: ${!!modifiers.ctrl}, shiftKey: ${!!modifiers.shift} }))`);
  const history = () => evaluate("[...document.querySelectorAll('.session-history .session-message--user')].map(node => node.textContent)");
  const running = "!!document.querySelector('.composer [aria-label=\"Stop response\"]')";
  try {
    if (await evaluate("document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === 'false'")) await click('.sidebar-toggle');
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait("document.querySelector('.composer__input').readOnly === false");
    await chooseFirstModel(driver);

    // A message written while the agent runs a tool queues, then goes at that tool step as the next message.
    await set('.composer__input', 'Run the build'); await enter();
    await wait(running);
    await set('.composer__input', 'Also check the tests');
    await wait("!!document.querySelector('.composer [aria-label=\"Queue message\"]')");
    await enter();
    await wait("document.querySelector('.queued-follow-up__status')?.textContent === 'Queued' && document.querySelector('.composer__input').value === ''");
    await captureUI(driver, 'follow-up-queued');
    await wait("!document.querySelector('.queued-follow-up')");
    await wait("[...document.querySelectorAll('.session-history')].some(node => node.textContent.includes('Answered: Also check the tests'))");
    assert.deepEqual(await history(), ['Run the build', 'Also check the tests']);
    await wait(`!${running}`);

    // Cancel takes a queued message back into the composer; Stop gives back the rest.
    await set('.composer__input', 'Wait here'); await enter();
    await wait(running);
    await set('.composer__input', 'First thought'); await enter();
    await wait("document.querySelectorAll('.queued-follow-up').length === 1");
    await click('.queued-follow-up [aria-label="Cancel and return to the composer"]');
    await wait("document.querySelector('.composer__input').value === 'First thought' && !document.querySelector('.queued-follow-up')");
    await set('.composer__input', 'Second thought'); await enter();
    await wait("document.querySelectorAll('.queued-follow-up').length === 1");
    await click('.composer [aria-label="Stop response"]');
    await wait("document.querySelector('.composer__input').value === 'Second thought' && !document.querySelector('.queued-follow-up')");
    await wait(`!${running}`);
    assert.deepEqual(await history(), ['Run the build', 'Also check the tests', 'Wait here'], 'nothing taken back was sent');

    // Settings: Steer sends at once; Ctrl+Enter queues for one message instead.
    await click('.sidebar-footer [aria-label="Settings"]'); await wait("!!document.querySelector('.settings-navigation')");
    await evaluate("[...document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === 'General').click()");
    await wait("!!document.querySelector('button[aria-label=\"Follow-up behavior\"]')");
    await click('button[aria-label="Follow-up behavior"]'); await wait("!!document.querySelector('[role=menu][aria-label=\"Follow-up behavior\"]:popover-open')");
    await captureUI(driver, 'settings-select-menu');
    await evaluate("document.querySelector('[role=menu][aria-label=\"Follow-up behavior\"]').hidePopover()");
    // Every settings menu opens under its own button, also one wider than the button at the window's edge.
    for (const label of ['Follow-up behavior', 'Thread notifications']) {
      await click(`button[aria-label="${label}"]`); await wait(`!!document.querySelector('[role=menu][aria-label="${label}"]:popover-open')`);
      const box = await evaluate(`(() => { const button = document.querySelector('button[aria-label="${label}"]').getBoundingClientRect(), menu = document.querySelector('[role=menu][aria-label="${label}"]').getBoundingClientRect();
        return { gap: Math.round(menu.top - button.bottom), below: menu.top >= button.bottom, near: menu.top - button.bottom < 16, right: Math.abs(menu.right - button.right) < 2, inside: menu.left >= 0 && menu.right <= innerWidth }; })()`);
      const { gap: _gap, ...placed } = box;
      assert.deepEqual(placed, { below: true, near: true, right: true, inside: true }, label);
      if (label === 'Thread notifications') await captureUI(driver, 'settings-select-wide');
      await evaluate(`document.querySelector('[role=menu][aria-label="${label}"]').hidePopover()`);
    }
    await chooseOption(driver, 'Follow-up behavior', 'Steer');
    await wait(`${chosenOption('Follow-up behavior')} === 'Steer'`);
    await captureUI(driver, 'follow-up-settings');
    await click('[aria-label="Close settings"]'); await wait("!document.querySelector('.settings-page')");
    await set('.composer__input', 'Run the build again'); await enter();
    await wait(running);
    await set('.composer__input', 'Steer this way'); await enter();
    await wait("document.querySelector('.queued-follow-up__status')?.textContent === 'Sending'");
    await wait("[...document.querySelectorAll('.session-history')].some(node => node.textContent.includes('Answered: Steer this way'))");
    await wait(`!${running}`);
    assert.deepEqual((await history()).slice(-2), ['Run the build again', 'Steer this way']);

    // Edit from here: the thread rewinds to before the message, which returns to the composer; files stay in the checkout.
    await wait("(() => { if (!document.querySelector('.edit-from-here')) [...document.querySelectorAll('[aria-label=\"Edit from here\"]')].at(0)?.click(); return !!document.querySelector('.edit-from-here'); })()");
    await wait("document.querySelector('.edit-from-here h2')?.textContent === 'Edit from here?'");
    assert.match(await evaluate("document.querySelector('.edit-from-here .git-dialog__description').textContent"), /Files stay as they are because this thread shares the project directory\.$/);
    assert.equal(await evaluate("[...document.querySelectorAll('.edit-from-here button')].some(button => button.textContent === 'Revert files too')"), false);
    await captureUI(driver, 'edit-from-here');
    const editable = await evaluate("[...document.querySelectorAll('.session-history .session-message--user')].length");
    await evaluate("[...document.querySelectorAll('.edit-from-here button')].find(button => button.textContent === 'Cancel').click()");
    await wait("!document.querySelector('.edit-from-here')");
    await wait("(() => { if (!document.querySelector('.edit-from-here')) [...document.querySelectorAll('[aria-label=\"Edit from here\"]')].at(-1)?.click(); return !!document.querySelector('.edit-from-here'); })()");
    await evaluate("[...document.querySelectorAll('.edit-from-here button')].find(button => button.textContent === 'Revert and keep changes').click()");
    await wait("!document.querySelector('.edit-from-here') && document.querySelector('.composer__input').value === 'Steer this way'");
    assert.equal(await evaluate("[...document.querySelectorAll('.session-history .session-message--user')].length"), editable - 1);
    assert.equal((await history()).at(-1), 'Run the build again');
    assert.deepEqual(errors.filter(message => !message.includes('Input is not editable')), [], 'only the test\'s own retried typing may log');
    console.log('FLAME_FOLLOW_UPS_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'follow-up-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
