import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceSearch } from '../dist/backend/workspace-search/service.js';
import { WorkspaceIndex } from '../dist/backend/workspace-search/index.js';
import { normalizeSearchQuery } from '../dist/backend/workspace-search/results.js';

const projectId = '11111111-1111-4111-8111-111111111111';
async function project() {
  const root = await mkdtemp(join(tmpdir(), 'flame-search-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  await mkdir(join(root, 'src', 'components'), { recursive: true }); await mkdir(join(root, 'node_modules', 'dep'), { recursive: true }); await mkdir(join(root, 'dist'));
  await writeFile(join(root, '.gitignore'), 'node_modules/\ndist/\n');
  for (const path of ['src/app.ts', 'src/components/Button.tsx', 'src/components/button.css', 'README.md', 'node_modules/dep/app.ts', 'dist/app.js']) await writeFile(join(root, path), 'x\n');
  return root;
}

test('search finds files and folders by fuzzy name, respects .gitignore and returns project-relative POSIX paths', async () => {
  const root = await project(), search = new WorkspaceSearch(target => { if (target.projectId !== projectId) throw new Error('missing'); return root; });
  try {
    const app = await search.search({ projectId }, 'app', 20);
    assert.ok(app.entries.some(entry => entry.path === 'src/app.ts' && entry.kind === 'file'), JSON.stringify(app));
    assert.ok(!app.entries.some(entry => entry.path.startsWith('node_modules') || entry.path.startsWith('dist')), 'ignored paths stay out');
    assert.deepEqual((await search.search({ projectId }, '@./src/comp', 20)).entries.find(entry => entry.kind === 'directory'), { path: 'src/components', kind: 'directory' }, 'folders come without a trailing slash');
    assert.equal((await search.search({ projectId }, 'buton', 20)).entries[0]?.path.startsWith('src/components/'), true, 'typos still match');
    const limited = await search.search({ projectId }, 's', 1);
    assert.equal(limited.entries.length, 1); assert.equal(limited.truncated, true);
    await assert.rejects(search.search({ projectId: '22222222-2222-4222-8222-222222222222' }, 'app', 5), { code: 'NOT_FOUND' });
  } finally { search.close(); await rm(root, { recursive: true, force: true }); }
});

test('refresh picks up files the agent created, and idle indexes are released', async () => {
  const root = await project();
  const opened = [];
  const search = new WorkspaceSearch(() => root, path => { const index = WorkspaceIndex.open(path); opened.push(index); return index; }, 300);
  try {
    assert.equal((await search.search({ projectId }, 'newfile', 5)).entries.length, 0);
    await writeFile(join(root, 'src', 'newfile.ts'), 'x\n');
    search.refresh(root); search.refresh(root);
    let found = false;
    for (let i = 0; i < 50 && !found; i++) { found = (await search.search({ projectId }, 'newfile', 5)).entries.some(entry => entry.path === 'src/newfile.ts'); if (!found) await delay(100); }
    assert.ok(found, 'a new file becomes searchable');
    assert.equal(opened.length, 1, 'searches share one index');
    await delay(500);
    await search.search({ projectId }, 'app', 5);
    assert.equal(opened.length, 2, 'an idle index is released and rebuilt on demand');
    search.refresh('/unknown');
  } finally { search.close(); await rm(root, { recursive: true, force: true }); }
  await assert.rejects(search.search({ projectId }, 'app', 5), { code: 'UNAVAILABLE' }, 'closed search refuses work');
});

test('queries drop the characters people type before paths', () => {
  assert.equal(normalizeSearchQuery('  @./Src/App '), 'src/app');
  assert.equal(normalizeSearchQuery('/abs'), 'abs');
});
