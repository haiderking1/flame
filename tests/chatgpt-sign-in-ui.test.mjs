import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

test('Sign in with ChatGPT UI: both sign-ins offered, browser sign-in, plan usage and sign-out', { timeout: 60_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'flame-chatgpt-sign-in-ui-'));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.FLAME_RENDERER_URL;
  const child = spawn(electron, ['tests/fixtures/chatgpt-sign-in.mjs', '--ozone-platform=headless', `--user-data-dir=${join(home, 'profile')}`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk; });
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 57_000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, diagnostics);
    assert.ok(diagnostics.includes('FLAME_CHATGPT_SIGN_IN_OK'), `Sign-in UI assertions did not finish:\n${diagnostics}`);
  } finally { clearTimeout(timer); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
});
