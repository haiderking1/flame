import assert from 'node:assert/strict';
import { app, ipcMain } from 'electron';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import { Effect } from 'effect';
import { createWindow } from '../../dist/main/window.js';
import { startServer } from '../../dist/backend/server.js';
import { ProjectStore } from '../../dist/backend/projects/store.js';
import { SessionRepository } from '../../dist/backend/sessions/repository.js';
import { CodexModelsClient } from '../../dist/backend/models/client.js';
import { CodexInferenceClient } from '../../dist/backend/turns/client.js';
import { rendererDriver } from '../helpers/rendererDriver.mjs';
import { checkGitUI } from '../helpers/checklistGit.mjs';
import { checkPanels } from '../helpers/checklistPanels.mjs';
import { checkMentions } from '../helpers/checklistMentions.mjs';
import { checkPersistence } from '../helpers/checklistPersistence.mjs';
import { checkHistory } from '../helpers/checklistHistory.mjs';
import { checkActivity, seedActivity } from '../helpers/checklistActivity.mjs';
import { checkSearch } from '../helpers/checklistSearch.mjs';
import { checkUnavailableGit } from '../helpers/checklistUnavailableGit.mjs';
import { chooseGitTextModel, resetGitTextModel } from '../helpers/checklistGitSettings.mjs';
import { processMemory } from '../helpers/checklistMetrics.mjs';
import { installFakeGitHub } from '../helpers/fakeHosting.mjs';
const started = performance.now();
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  const home = app.getPath('home'), userData = app.getPath('userData');
  await mkdir(join(home, '.flame', 'agent'), { recursive: true, mode: 0o700 });
  await writeFile(join(home, '.flame', 'agent', 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'fake-access', refresh: 'fake-refresh', expires: Date.now() + 3600_000, accountId: 'checklist-account', email: null, plan: 'plus' } }), { mode: 0o600 });
  const filename = join(userData, 'flame.sqlite'), projects = new ProjectStore(filename);
  const project = projects.add(join(userData, 'Project')), other = projects.add(join(userData, 'Other'));
  await mkdir(project.path); await mkdir(other.path); await writeFile(join(project.path, 'base.ts'), 'const base = 1;\n');
  const repository = new SessionRepository(join(userData, 'projects'), projects), location = { projectId: project.id, sessionId: randomUUID() };
  repository.create(location, { modelId: 'test-model', effort: 'low', serviceTier: 'default' });
  repository.use(location, db => { let document = db.read(); for (let i = 0; i < 300; i++) document = db.append(document.revision, randomUUID(), `History message ${i}. This is an immutable saved message.`); });
  const activityLocation = seedActivity(repository, project.id);
  const model = { slug: 'test-model', display_name: 'Test model', priority: 0, visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low', description: 'Fast' }] };
  const modelsClient = new CodexModelsClient(async () => Response.json({ models: [model,...Array.from({length:199}, (_,i)=>({...model,slug:`model-${i+1}`,display_name:`Model ${i+1}`,priority:i+1}))] }));
  if (process.env.FLAME_TEST_GIT_UNAVAILABLE) { const filename = join(userData,'git.sqlite'), future = new DatabaseSync(filename); future.exec('PRAGMA user_version=999'); future.close(); await chmod(filename,0o600); }
  const opened = [], gitModels = [];
  // Hosting CLIs are faked so tests never reach real GitHub or GitLab accounts.
  await installFakeGitHub({ authenticated: false });
  const inferenceClient = new CodexInferenceClient(async (_url, options) => {
    // Git text requests answer at once with JSON, like the model would; chat requests stream paced paragraphs.
    const body = JSON.parse(options.body);
    if (/git commit messages/.test(body.instructions)) {
      gitModels.push(body.model);
      const reply = JSON.stringify(/keys: title, body/.test(JSON.stringify(body.input)) ? { title: 'Generated change request', body: '## Summary\n- test' } : { subject: 'Add base source', body: '' });
      const events = [{ type: 'response.output_item.done', output_index: 0, item: { id: 'git', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: reply }] } }, { type: 'response.completed', response: { status: 'completed', output: [] } }];
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
    }
    const chunks = [...Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. This is paced output that should not disturb saved rows.\n\n`), '```rust\n', ...Array.from({length:8},(_,chunk)=>Array.from({length:16},(_,line)=>`let sample${chunk*16+line}: usize = ${chunk*16+line};\n`).join('')), '```\n'];
    const text = chunks.join('');
    let cancelled = false;
    const stream = new ReadableStream({ start(controller) { const emit = event => { if (!cancelled) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); };
      void (async () => { for (const chunk of chunks) { if(cancelled) break; emit({ type: 'response.output_text.delta', output_index: 0, delta: chunk }); await new Promise(resolve => setTimeout(resolve, 120)); }
        if (!cancelled) { emit({ type: 'response.output_item.done', output_index: 0, item: { id: 'message', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } }); emit({ type: 'response.completed', response: { status: 'completed', output: [] } }); controller.close(); }
      })().catch(error => { if (!cancelled) controller.error(error); }); }, cancel() { cancelled = true; } });
    return new Response(stream);
  });
  let ready; const portReady = new Promise(resolve => { ready = resolve; }), abort = new AbortController();
  const server = Effect.runPromise(Effect.scoped(startServer({ filename, token: 'checklist-token', origin: 'file://', openBrowser: async () => assert.fail('No external sign-in in tests'), openPath: async path => { opened.push(path); }, modelsClient, inferenceClient, ready })), { signal: abort.signal }).catch(() => {});
  const port = await portReady; ipcMain.handle('flame:connection', () => `ws://127.0.0.1:${port}/rpc?token=checklist-token`);
  const window = await createWindow(); window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1800, height: 1100, deviceScaleFactor: 1, mobile: false });
  const driver = rendererDriver(window), { evaluate, wait, click } = driver;
  const measurements = { hardware: { cpu: cpus()[0]?.model, logicalCores: cpus().length, memoryGiB: totalmem() / 1024 ** 3 }, electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node };
  const rendererErrors = [];
  window.webContents.on('console-message', details => { if (details.level === 'error') rendererErrors.push(details.message); });
  try {
    await wait("!!document.querySelector('.project-filter__option') && !!document.querySelector('.session-list__item')");
    measurements.firstUsableMs = performance.now() - started;
    await evaluate("window.__longFrames=[]; if(PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) new PerformanceObserver(list=>window.__longFrames.push(...list.getEntries().map(entry=>({duration:entry.duration,blocking:entry.blockingDuration,renderStart:entry.renderStart,styleLayoutStart:entry.styleAndLayoutStart,scripts:entry.scripts.map(script=>({duration:script.duration,invoker:script.invoker,forcedStyle:script.forcedStyleAndLayoutDuration}))})))).observe({type:'long-animation-frame',buffered:true}); true");
    await evaluate("window.__longTasks = []; new PerformanceObserver(list => { window.__longTasks.push(...list.getEntries().map(entry => entry.duration)); }).observe({type:'longtask',buffered:true}); true");
    await click('[aria-label^="Filter threads by project"]'); await wait("document.querySelector('.project-filter').matches(':popover-open')");
    await evaluate(`[...document.querySelectorAll('.project-filter__option')].find(option => option.title === ${JSON.stringify(project.path)}).click()`);
    await wait("document.querySelector('.composer__input').readOnly === false && document.querySelector('.workspace__composer').dataset.empty === 'true'");
    if (process.env.FLAME_TEST_GIT_UNAVAILABLE) { await checkUnavailableGit(driver, repository, location); }
    else {
    console.log('CHECKLIST_STAGE git'); await chooseGitTextModel(driver, 'Model 3');
    await wait("document.querySelector('.composer__input').readOnly === false");
    await checkGitUI(driver, project, other, opened);
    assert.ok(gitModels.length > 0 && gitModels.every(model => model === 'model-3'), `Git text uses the model chosen in Settings: ${gitModels.join(', ')}`);
    await resetGitTextModel(driver);
    await wait("document.querySelector('.composer__input').readOnly === false && document.querySelector('.workspace__composer').dataset.empty === 'true'");
    console.log('CHECKLIST_STAGE panels'); await checkPanels(driver, project, measurements);
    console.log('CHECKLIST_STAGE mentions'); await checkMentions(driver);
    console.log('CHECKLIST_STAGE persistence'); await checkPersistence(driver, project, location.sessionId, measurements);
    console.log('CHECKLIST_STAGE history'); await checkHistory(driver, location.sessionId, measurements);
    console.log('CHECKLIST_STAGE activity'); await checkActivity(driver, activityLocation);
    console.log('CHECKLIST_STAGE search'); await checkSearch(driver, project, measurements);
    }
    const allTrace = await evaluate('window.__flamePerformance ?? null');
    if (allTrace) { measurements.allReactCommitMs = allTrace.commits; measurements.allReactRenderMs = allTrace.renders; }
    measurements.longTasksMs = await evaluate('window.__longTasks'); measurements.longFrames = await evaluate('window.__longFrames'); measurements.inputPhases = await evaluate('window.__inputPhases');
    measurements.domNodes = await evaluate("document.querySelectorAll('*').length");
    await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    measurements.heap = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    if (process.env.FLAME_BENCHMARK_OUTPUT) {
      measurements.workerRoundTrips = await evaluate('window.__workerTimings');
      measurements.activeWorkers = await evaluate('window.__workers.filter(worker => !worker.stopped).length');
      measurements.viewport = await evaluate('({width:innerWidth,height:innerHeight,scale:devicePixelRatio})');
      measurements.processMemory = processMemory(app);
      await new Promise(resolve => setTimeout(resolve, 31_000));
      assert.ok(await evaluate("window.__workers.filter(worker => !/highlight\.worker/.test(worker.source)).every(worker => worker.stopped)"), 'idle panel workers are released');
      await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
      measurements.heapAfterIdle = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage'); measurements.processMemoryAfterIdle = processMemory(app);
      await writeFile(process.env.FLAME_BENCHMARK_OUTPUT, JSON.stringify(measurements, null, 2) + '\n');
    }
    assert.ok(!rendererErrors.some(message => /Content Security Policy|Refused to|Uncaught|Maximum update depth/.test(message)), rendererErrors.join('\n'));
    console.log('FLAME_CHECKLIST_UI_OK', JSON.stringify(measurements));
    window.destroy(); abort.abort(); await server; projects.close(); app.exit(0);
  } catch (error) { console.error(error, rendererErrors); window.destroy(); abort.abort(); await Promise.race([server, new Promise(resolve => setTimeout(resolve, 3000))]); projects.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
