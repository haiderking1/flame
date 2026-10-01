import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

test('Electron loads the 512 px app icon, made from the 1024 px master', () => {
  const run = spawnSync(electron, ['tests/fixtures/app-icon.mjs', '--ozone-platform=headless'], { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(run.stdout.includes('FLAME_APP_ICON_OK'), run.stdout + run.stderr);
});
