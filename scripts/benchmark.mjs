import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import electron from 'electron';
import { measureStartup } from './performance/startup.mjs';
import { checkBudgets, percentile } from './performance/budgets.mjs';
function run(command, args, env = process.env, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore','pipe','pipe'] }); let output = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(`${command} exited ${code}\n${output}`)); });
  });
}
const home = await mkdtemp(join(tmpdir(), 'flame-performance-'));
const outputFile = process.argv[2] ?? '/tmp/flame-performance.json';
try {
  await run('bun', ['run','build'], { ...process.env, FLAME_PROFILE: '1' });
  const startup = await measureStartup();
  const uiReport = join(home,'ui.json');
  await run(electron, ['tests/fixtures/checklist.mjs','--ozone-platform=headless',`--user-data-dir=${join(home,'profile')}`], { ...process.env, FLAME_RENDERER_URL: '', HOME: home, USERPROFILE: home, FLAME_BENCHMARK_OUTPUT: uiReport }, 90_000);
  const ui = JSON.parse(await readFile(uiReport,'utf8'));
  const highlighting = JSON.parse(await run(process.execPath, ['scripts/benchmark-highlighting.mjs']));
  const report = { measuredAt: new Date().toISOString(), startup, ui, highlighting };
  await writeFile(outputFile, JSON.stringify(report,null,2) + '\n');
  checkBudgets(report);
  console.log(JSON.stringify({ outputFile, startup, firstPanelMs: ui.firstPanelMs, inputP95Ms: percentile([...ui.inputLatenciesMs,...ui.panelInputLatenciesMs,...ui.searchInputLatenciesMs]), reactCommitP95Ms: percentile(ui.allReactCommitMs), retainedHeapMiB: ui.heapAfterIdle.usedSize / 1024 ** 2 }, null, 2));
} finally {
  await rm(home,{recursive:true,force:true});
  // Leave the normal production bundle in place, not the profiling build.
  await run('bun',['run','build:renderer'], { ...process.env, FLAME_PROFILE: '0' });
}
