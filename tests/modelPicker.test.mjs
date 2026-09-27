import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { filterModels, isLegacyModel } from '../src/renderer/components/composer/models/modelOptions.ts';

test('model search matches names, IDs and descriptions without changing catalog order', () => {
  const models = [{ id: 'test-a', name: 'Test Alpha', description: 'Fast coding' }, { id: 'test-b', name: 'Test Beta', description: 'Deep reasoning' }];
  assert.deepEqual(filterModels(models, '  '), models);
  assert.deepEqual(filterModels(models, 'ALPHA coding'), [models[0]]);
  assert.deepEqual(filterModels(models, 'test-b'), [models[1]]);
  assert.deepEqual(filterModels(models, 'missing'), []);
  assert.deepEqual(filterModels([], 'anything'), []);
});

test('legacy grouping includes only the GPT-5.5 and GPT-5.6 families', () => {
  for (const id of ['gpt-5.5', 'gpt-5.6', 'gpt-5.6-mini', 'gpt-5.5-codex']) assert.equal(isLegacyModel({ id, name: id }), true);
  for (const id of ['gpt-5.60', 'gpt-5.50', 'gpt-6', 'other']) assert.equal(isLegacyModel({ id, name: id }), false);
});

test('model picker UI: live catalog, search, selection, cache, focus and viewport containment', { timeout: 15_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'flame-model-picker-'));
  await mkdir(join(home, '.flame', 'agent'), { recursive: true, mode: 0o700 });
  await writeFile(join(home, '.flame', 'agent', 'auth.json'), JSON.stringify({ 'openai-codex': {
    type: 'oauth', access: 'fake-access', refresh: 'fake-refresh', expires: Date.now() + 3600_000,
    accountId: 'fake-account', email: null, plan: 'prolite',
  } }), { mode: 0o600 });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.FLAME_RENDERER_URL;
  const child = spawn(electron, ['tests/fixtures/model-picker.mjs', '--ozone-platform=headless', `--user-data-dir=${join(home, 'profile')}`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk; });
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 13_000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, diagnostics);
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
});
