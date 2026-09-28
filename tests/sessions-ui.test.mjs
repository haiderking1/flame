import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

test('session UI: projects, isolated drafts/settings, persisted messages, resume, search and floating composer', { timeout: 30_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'flame-session-ui-'));
  await mkdir(join(home, '.flame', 'agent'), { recursive: true, mode: 0o700 });
  await writeFile(join(home, '.flame', 'agent', 'auth.json'), JSON.stringify({ 'openai-codex': {
    type: 'oauth', access: 'fake-access', refresh: 'fake-refresh', expires: Date.now() + 3600_000,
    accountId: 'fake-account', email: null, plan: 'prolite',
  } }), { mode: 0o600 });
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.FLAME_RENDERER_URL;
  const child = spawn(electron, ['tests/fixtures/sessions.mjs', '--ozone-platform=headless', `--user-data-dir=${join(home, 'profile')}`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk; });
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 27_000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, diagnostics);
    assert.ok(diagnostics.includes('FLAME_SESSION_UI_OK'), `Session UI assertions did not finish:\n${diagnostics}`);
  } finally { clearTimeout(timer); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
});
