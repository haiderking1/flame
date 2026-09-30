import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { MAX_IMAGES, MAX_IMAGE_BYTES } from '../dist/contracts/image-types.js';

test('image draft storage: accepted cleanup preserves newer attachments, serializes late writes, and reconciles inherited saves', { timeout: 15_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'flame-image-draft-storage-'));
  const source = stripTypeScriptTypes((await readFile(new URL('../src/renderer/components/images/draft-storage.ts', import.meta.url), 'utf8'))
    .replace(/^import .*image-types.*;$/m, `const MAX_IMAGES=${MAX_IMAGES}, MAX_IMAGE_BYTES=${MAX_IMAGE_BYTES};`), { mode: 'strip' }).replace(/^export /gm, '');
  const sourceFile = join(home, 'draft-storage.js'); await writeFile(sourceFile, source);
  const child = spawn(electron, ['tests/fixtures/image-draft-storage.mjs', '--ozone-platform=headless', `--user-data-dir=${join(home, 'profile')}`], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home, USERPROFILE: home, FLAME_DRAFT_TEST_SOURCE: sourceFile },
  });
  let diagnostics = ''; child.stdout.on('data', chunk => { diagnostics += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
    assert.equal(code, 0, `${diagnostics}\nExit signal: ${child.signalCode}`); assert.ok(diagnostics.includes('FLAME_IMAGE_DRAFT_STORAGE_OK'), diagnostics);
  } finally { clearTimeout(timer); child.kill('SIGKILL'); await rm(home, { recursive: true, force: true }); }
});
