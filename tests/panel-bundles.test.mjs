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
  assert.ok(!files.some(file => /DiffPanel-|SettingsPage-|CommitDialog-|PublishDialog-|AgentsPanel-|AgentTranscript-|AgentSpawnRow-|wasm-|parse\.worker/.test(file)), files.join('\n'));
  assert.ok(Object.values(manifest).some(entry => entry.isDynamicEntry && entry.file.includes('DiffPanel-')));
  assert.ok(Object.values(manifest).some(entry => entry.isDynamicEntry && entry.file.includes('SettingsPage-')));
  assert.ok(Object.values(manifest).some(entry => entry.isDynamicEntry && entry.file.includes('AgentsPanel-')));
  const initialBytes = (await Promise.all(files.filter(file => file.endsWith('.js')).map(file => readFile(join('dist/renderer',file))))).reduce((sum,file) => sum + file.byteLength, 0);
  // Re-measured at 1.08 MiB when the composer became a ProseMirror (Tiptap) editor, which must be ready at first paint, and
  // at 1.126 MiB when app updates joined startup: the update state and its toast must be live at once; the update button,
  // its dialog and icon load only when an update needs them; and at 1.138 MiB when subagents joined: a thread's team state,
  // its panel toggle and composer banner are live at once; the Agents panel, transcripts and chat rows load when used.
  assert.ok(initialBytes < 1175 * 1024, `initial JS exceeds the measured envelope: ${initialBytes}`);
});
