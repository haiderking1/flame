import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
test('production startup excludes optional panels and their heavy code-view dependencies', async () => {
  const manifest = JSON.parse(await readFile('dist/renderer/.vite/manifest.json','utf8'));
  const initial = new Set();
  const visit = key => { if (initial.has(key)) return; initial.add(key); for (const dependency of manifest[key]?.imports ?? []) visit(dependency); };
  visit('index.html');
  const files = [...initial].map(key => manifest[key]?.file ?? key);
  assert.ok(!files.some(file => /DiffPanel-|SettingsPage-|CommitDialog-|PublishDialog-|wasm-|parse\.worker/.test(file)), files.join('\n'));
  assert.ok(Object.values(manifest).some(entry => entry.isDynamicEntry && entry.file.includes('DiffPanel-')));
  assert.ok(Object.values(manifest).some(entry => entry.isDynamicEntry && entry.file.includes('SettingsPage-')));
  const initialBytes = (await Promise.all(files.filter(file => file.endsWith('.js')).map(file => readFile(join('dist/renderer',file))))).reduce((sum,file) => sum + file.byteLength, 0);
  assert.ok(initialBytes < 950 * 1024, `initial JS exceeds the measured envelope: ${initialBytes}`);
});
