import assert from 'node:assert/strict';
import { app, ipcMain, Notification } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { installNotifications } from '../../dist/main/notifications.js';
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
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const userData = app.getPath('userData'), filename = join(userData, 'flame.sqlite'), projects = new ProjectStore(filename);
  const projectPath = join(userData, 'Project'); await mkdir(projectPath); await writeFile(join(projectPath, 'README.md'), '# Project\n');
  const project = projects.add(projectPath);
  const model = { slug: 'test-model', display_name: 'Test model', priority: 0, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }] };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [model] }));
  let release = () => {};
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (isTitleRequest(body)) return titleReply();
    const last = body.input.filter(item => item.role === 'user').at(-1)?.content?.find(part => part.type === 'input_text')?.text ?? '';
    if (/^Slow job/.test(last)) await new Promise(resolve => { release = resolve; });
    return new Response(events([say(`Answered: ${last}`)]));
  });
  installNotifications();
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename, token: 'notify-token', origin: 'file://', openBrowser: async () => assert.fail('No sign-in in tests'), modelsClient, inferenceClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=notify-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait, click } = driver;
  const set = async (selector, value) => {
    for (let attempt = 1; ; attempt++) {
      await wait(`document.querySelector(${JSON.stringify(selector)})?.readOnly === false`);
      try { return await driver.set(selector, value); } catch (error) { if (attempt >= 3) throw error; await driver.settle(); }
    }
  };
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error' && !details.message.includes('Input is not editable')) errors.push(details.message); });
  const enter = () => evaluate("document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  const openSettings = async () => {
    await click('.sidebar-footer [aria-label="Settings"]'); await wait("!!document.querySelector('.settings-navigation')");
    await evaluate("[...document.querySelectorAll('.settings-navigation button')].find(button => button.textContent === 'General').click()");
    await wait("!!document.querySelector('button[aria-label=\"Thread notifications\"]')");
  };
  const status = title => `document.querySelector('[aria-label=${JSON.stringify(title)}]')?.closest('.session-list__row')?.querySelector('.session-list__status')?.textContent ?? null`;
  const newThread = async () => {
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait("document.querySelector('.composer__input').readOnly === false && document.querySelector('.workspace__composer').dataset.empty === 'true'");
  };
  try {
    if (await evaluate("document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === 'false'")) await click('.sidebar-toggle');
    // Settings: system notifications only when the system can show them; in-app toasts on.
    await openSettings();
    await chooseOption(driver, 'Thread notifications', 'Notifications with sound');
    if (Notification.isSupported()) await wait(`${chosenOption('Thread notifications')} === 'Notifications with sound'`);
    else await wait(`document.querySelector('#thread-notifications-description').textContent === 'Notifications are unavailable on this system. Sound only is still available.' && ${chosenOption('Thread notifications')} === 'Off'`);
    await click('[aria-label="In-app notifications"]');
    await wait("document.querySelector('[aria-label=\"In-app notifications\"]').checked");
    await captureUI(driver, 'notification-settings');
    await click('[aria-label="Close settings"]'); await wait("!document.querySelector('.settings-page')");

    await newThread();
    await chooseFirstModel(driver);
    await set('.composer__input', 'Slow job'); await enter();
    await wait(`${status('Slow job')} === 'Working'`);

    // Another thread is open when the slow one finishes: a toast offers to open it, and the sidebar marks it Completed.
    await newThread();
    await set('.composer__input', 'Quick question'); await enter();
    await wait("[...document.querySelectorAll('.session-history')].some(node => node.textContent.includes('Answered: Quick question'))");
    assert.equal(await evaluate("[...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('Quick question'))"), false, 'the open thread does not toast');
    window.focus(); await evaluate("window.focus()");
    release();
    await wait("[...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('Thread completed') && toast.textContent.includes('Slow job'))");
    await wait(`${status('Slow job')} === 'Completed'`);
    await captureUI(driver, 'notification-toast');
    // Hovering the label shows T3 Code's tooltip above it; leaving hides it, and the label's own text is unchanged.
    const label = await evaluate(`(() => { const rect = document.querySelector('[aria-label="Slow job"]').closest('.session-list__row').querySelector('.session-list__status').getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), top: rect.top }; })()`);
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: label.x, y: label.y });
    await wait("[...document.querySelectorAll('.tooltip')].some(tip => tip.matches(':popover-open') && tip.textContent === 'Completed')");
    const tip = await evaluate("(() => { const rect = [...document.querySelectorAll('.tooltip')].find(tip => tip.matches(':popover-open')).getBoundingClientRect(); return { bottom: rect.bottom, height: rect.height }; })()");
    assert.ok(tip.bottom <= label.top && label.top - tip.bottom <= 6 && tip.height > 0, `the tooltip sits just above the label: ${JSON.stringify({ tip, label })}`);
    assert.equal(await evaluate(status('Slow job')), 'Completed');
    await wait("getComputedStyle([...document.querySelectorAll('.tooltip')].find(tip => tip.matches(':popover-open'))).opacity === '1'");
    await captureUI(driver, 'status-tooltip');
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 500 });
    await wait("![...document.querySelectorAll('.tooltip')].some(tip => tip.matches(':popover-open'))");
    await evaluate("[...document.querySelectorAll('.toast button')].find(button => button.textContent === 'Open thread').click()");
    await wait("[...document.querySelectorAll('.session-history')].some(node => node.textContent.includes('Answered: Slow job'))");
    await wait(`${status('Slow job')} === null`);

    // Mark unread brings the Completed label back.
    await wait("document.querySelector('[aria-label=\"Options for Slow job\"]')?.disabled === false");
    await click('[aria-label="Options for Slow job"]'); await wait("!!document.querySelector('.session-menu')");
    await evaluate("[...document.querySelectorAll('.session-menu button')].find(button => button.textContent === 'Mark unread').click()");
    await wait(`${status('Slow job')} === 'Completed'`);
    assert.deepEqual(errors, []);
    console.log('FLAME_NOTIFICATIONS_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'notification-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
