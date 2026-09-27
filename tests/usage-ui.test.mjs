import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

test('usage UI: cached weekly usage and Yes/No confirmation with safe default and duplicate protection', { timeout: 20_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'flame-usage-ui-'));
  const profile = join(home, 'profile');
  await mkdir(profile);
  await mkdir(join(home, '.flame', 'agent'), { recursive: true, mode: 0o700 });
  await writeFile(join(home, '.flame', 'agent', 'auth.json'), JSON.stringify({ 'openai-codex': {
    type: 'oauth', access: 'fake-access', refresh: 'fake-refresh', expires: Date.now() + 3600_000,
    accountId: 'fake-account', email: null, plan: 'prolite',
  } }), { mode: 0o600 });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.FLAME_RENDERER_URL;
  const child = spawn(electron, ['tests/fixtures/usage.mjs', '--ozone-platform=headless', `--user-data-dir=${profile}`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk; });
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 18_000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, diagnostics);
  } finally { clearTimeout(timeout); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
});
