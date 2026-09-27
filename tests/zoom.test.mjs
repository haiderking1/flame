import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import electron from 'electron';

test('zoom shortcuts, half-level steps, reset, header size, and restart persistence', { timeout: 20_000 }, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'flame-zoom-test-'));
  try {
    for (const extra of [[], ['--verify-restored']]) {
      await new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.FLAME_RENDERER_URL;
        const child = spawn(electron, [fileURLToPath(new URL('./fixtures/zoom.mjs', import.meta.url)), `--user-data-dir=${profile}`, ...extra], { env, stdio: ['ignore', 'ignore', 'pipe'] });
        let output = '';
        child.stderr.on('data', (chunk) => { output += chunk; });
        const timer = setTimeout(() => { child.kill('SIGKILL'); }, 8_000);
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);
          try { assert.equal(code, 0, output); resolve(); } catch (error) { reject(error); }
        });
      });
    }
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
