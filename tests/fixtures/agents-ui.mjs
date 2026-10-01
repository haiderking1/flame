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

const stream = items => [...items.map((item, output_index) => ({ type: 'response.output_item.done', output_index, item })), { type: 'response.completed', response: { status: 'completed', output: [] } }]
  .map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
const say = text => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
let calls = 0;
const call = (name, args) => ({ type: 'function_call', id: `fc_${++calls}`, call_id: `call_${calls}`, name, arguments: JSON.stringify(args) });
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const userData = app.getPath('userData'), filename = join(userData, 'flame.sqlite'), projects = new ProjectStore(filename);
  const projectPath = join(userData, 'Project'); await mkdir(projectPath); await writeFile(join(projectPath, 'README.md'), '# Project\n');
  const project = projects.add(projectPath);
  const model = { slug: 'test-model', display_name: 'Test model', priority: 0, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }] };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [model] }));
  // The scout keeps working until stopped; the writer answers at once.
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (isTitleRequest(body)) return titleReply();
    const agent = body.instructions.match(/You are `([^`]+)`/)?.[1];
    if (agent === '/root/scout') {
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    if (agent === '/root/writer') return new Response(stream([say('Writer done: the docs are written.')]));
    const results = body.input.filter(item => item.type === 'function_call_output').length;
    const steps = [call('spawn_agent', { task_name: 'scout', message: 'Inspect the code' }), call('spawn_agent', { task_name: 'writer', message: 'Write the docs', fork_turns: 'none' })];
    return new Response(stream(results < steps.length ? [steps[results]] : [say('Started a team.')]));
  });
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  void Effect.runPromise(Effect.scoped(startServer({ filename, token: 'agents-token', origin: 'file://', openBrowser: async () => assert.fail('No sign-in in tests'), modelsClient, inferenceClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=agents-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait, click, set } = driver;
  const errors = []; window.webContents.on('console-message', details => { if (details.level === 'error') errors.push(details.message); });
  const rows = "[...document.querySelectorAll('.agents-panel .agent-row')].map(row => ({ name: row.querySelector('.agent-row__name').textContent, role: row.querySelector('.agent-row__role')?.textContent ?? null, tone: row.dataset.agentTone, activity: row.querySelector('.agent-row__activity').textContent }))";
  try {
    if (await evaluate("document.querySelector('.sidebar-toggle')?.getAttribute('aria-expanded') === 'false'")) await click('.sidebar-toggle');
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait("document.querySelector('.composer__input').readOnly === false");
    await chooseFirstModel(driver);
    assert.equal(await evaluate("!!document.querySelector('[aria-controls=workspace-agents]')"), false, 'no Agents toggle before the thread has agents');
    await set('.composer__input', 'Build with a team');
    await evaluate("document.querySelector('.composer__input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");

    // The run's spawns show as one row; the thread's agent finishes while the scout keeps working.
    await wait("[...document.querySelectorAll('.agent-spawn__label')].some(label => label.textContent === 'Kicked off 2 subagents')");
    await wait("[...document.querySelectorAll('.session-history')].some(node => node.textContent.includes('Started a team.'))");
    await wait("document.querySelector('.agents-banner')?.textContent.includes('1 agent working')");
    await wait("[...document.querySelectorAll('.session-list__status')].some(status => status.textContent === 'Working')");
    await wait("document.querySelector('[aria-controls=workspace-agents]')?.getAttribute('aria-label') === 'Toggle agents panel, 1 agent working'");
    assert.equal(await evaluate("document.querySelector('.agents-toggle__badge').textContent"), '1');
    await click('.agent-spawn .work-tool__toggle');
    await wait("document.querySelectorAll('.agent-spawn__members li').length === 2");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.agent-spawn__task')].map(task => task.textContent)"), ['Inspect the code', 'Write the docs']);
    await captureUI(driver, 'agents-spawn-row');

    // The Agents panel lists the team; an agent opens to its transcript.
    await click('.agents-banner [aria-label="View agents"]');
    await wait("document.querySelectorAll('.agents-panel .agent-row').length === 2");
    const listed = await evaluate(rows);
    assert.deepEqual(listed.map(row => [row.role, row.tone]), [['scout', 'working'], ['writer', 'idle']]);
    assert.equal(listed[1].activity, 'Writer done: the docs are written.');
    assert.match(await evaluate("document.querySelector('.agents-panel__footer').textContent"), /● 1 working.*1 idle/);
    await captureUI(driver, 'agents-panel');
    await evaluate("[...document.querySelectorAll('.agent-row__open')][1].click()");
    await wait("document.querySelector('.agents-panel__transcript')?.textContent.includes('Writer done: the docs are written.')");
    assert.match(await evaluate("document.querySelector('.agents-panel__transcript').textContent"), /From \/root:\s*Write the docs/);
    assert.equal(await evaluate("document.querySelector('.agents-panel__transcript').textContent.includes('Message Type')"), false, 'the envelope is not shown');
    await captureUI(driver, 'agents-transcript');
    await click('[aria-label="Back to agents"]');
    await wait("document.querySelectorAll('.agents-panel .agent-row').length === 2");

    // Stop from the banner stops the team.
    await evaluate("[...document.querySelectorAll('.agents-banner button')].find(button => button.textContent === 'Stop').click()");
    await wait("!document.querySelector('.agents-banner')");
    await wait(`${rows}[0]?.tone === 'stopped'`);
    await wait("[...document.querySelectorAll('.agent-spawn__label')].some(label => label.textContent === 'Ran 2 subagents')");
    await wait("![...document.querySelectorAll('.session-list__status')].some(status => status.textContent === 'Working')");
    await click('[aria-label="Close agents panel"]'); await wait("!document.querySelector('#workspace-agents')");
    assert.deepEqual(errors.filter(message => !message.includes('flame:update-state')), []);
    console.log('FLAME_AGENTS_UI_OK');
    abort.abort(); window.destroy(); app.exit(0);
  } catch (error) { await captureUI(driver, 'agents-failure').catch(() => {}); throw error; }
}).catch(error => { console.error(error); app.exit(1); });
