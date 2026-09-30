import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

test('binary image HTTP uploads enforce authentication, persist without sessions, and adopt ready bytes',
  { timeout: 30000 }, async () => {
    const home = await mkdtemp(join(tmpdir(), 'flame-images-http-'));
    const child = spawn(process.execPath, ['tests/fixtures/images-http.mjs', home], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stdout.on('data', chunk => { diagnostics += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 27000);
    try {
      const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
      assert.equal(code, 0, diagnostics);
      assert.ok(diagnostics.includes('FLAME_IMAGES_HTTP_OK'), diagnostics);
    } finally { clearTimeout(timer); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
  });
