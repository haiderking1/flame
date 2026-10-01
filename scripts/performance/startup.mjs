import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import electron from 'electron';
import { debugPipe } from './debugPipe.mjs';
export async function measureStartup() {
  const samples = [];
  for (let trial = 0; trial < 3; trial++) {
    const home = await mkdtemp(join(tmpdir(), 'flame-startup-benchmark-'));
    const started = performance.now(), child = spawn(electron, ['.', '--ozone-platform=headless', '--remote-debugging-pipe', `--user-data-dir=${join(home,'profile')}`], { env: { ...process.env, FLAME_RENDERER_URL: '', HOME: home, USERPROFILE: home }, stdio: ['ignore','ignore','pipe','pipe','pipe'] });
    const send = debugPipe(child), exited = once(child,'exit'); let diagnostics = '';
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
    try {
      let page;
      for (let i = 0; i < 200; i++) { page = (await send('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.url.startsWith('file:')); if (page) break; await delay(10); }
      if (!page) throw new Error(`Renderer never opened: ${diagnostics}`);
      const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
      const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
      let firstLoadedMs;
      for (let i = 0; i < 300; i++) {
        if (!firstLoadedMs && await evaluate("document.readyState === 'complete' && !!document.querySelector('textarea')")) firstLoadedMs = performance.now() - started;
        if (await evaluate("!!document.querySelector('.sidebar-threads__empty button')")) break;
        await delay(10);
      }
      const firstUsableMs = performance.now() - started;
      const click = await evaluate("(() => { window.__clickStarted = performance.now(); document.querySelector('.sidebar-threads__empty button').click(); return window.__clickStarted; })()");
      for (let i = 0; i < 200 && !await evaluate("!!document.querySelector('.project-picker')"); i++) await delay(5);
      if (!await evaluate("!!document.querySelector('.project-picker')")) throw new Error('The first startup interaction did not respond');
      const interactionMs = await evaluate(`performance.now() - ${click}`);
      const loadedResources = await evaluate("performance.getEntriesByType('resource').map(entry => entry.name)");
      if (loadedResources.some(name => /DiffPanel-|parse\.worker|\/worker-/.test(name))) throw new Error('Optional code viewer entered the startup path');
      samples.push({ firstLoadedMs, firstUsableMs, interactionMs });
    } finally {
      child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer); await rm(home, { recursive: true, force: true });
    }
  }
  return samples;
}
