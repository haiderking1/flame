import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';
async function runFixture(extra = {}) {
  const home = await mkdtemp(join(tmpdir(), 'flame-checklist-ui-'));
  const child = spawn(electron, ['tests/fixtures/checklist.mjs', '--ozone-platform=headless', `--user-data-dir=${join(home, 'profile')}`], { env: { ...process.env, FLAME_RENDERER_URL: '', HOME: home, USERPROFILE: home, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 55_000);
  try { const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); }); assert.equal(code, 0, diagnostics); assert.match(diagnostics, /FLAME_CHECKLIST_UI_OK/); }
  finally { clearTimeout(timer); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
}
test('production UI: Git lifecycle, code workers, virtual history, nested activity, search, selection and draft durability', { timeout:60_000 }, () => runFixture());
test('production UI: unavailable Git persistence does not block chat and durable session writes', { timeout:60_000 }, () => runFixture({ FLAME_TEST_GIT_UNAVAILABLE:'1' }));
