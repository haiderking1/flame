import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProjectContextFiles } from '../dist/backend/project-context/service.js';
import { formatProjectContext } from '../dist/backend/project-context/format.js';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'flame-context-'));
  const cwd = join(root, 'project'), global = join(root, 'global');
  mkdirSync(cwd); mkdirSync(global);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const save = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };
  const warnings = [];
  const load = (directory = cwd, agentDir = global) => loadProjectContextFiles({ cwd: directory, agentDir,
    signal: new AbortController().signal, warn: message => warnings.push(message) });
  const own = files => files.filter(file => file.path.startsWith(root));
  return { root, cwd, global, save, load, own, warnings };
}
function linked(h, main, worktree, metadata = join(main, '.git')) {
  const directory = join(metadata, 'worktrees', 'feature');
  h.save(join(metadata, 'HEAD'), 'ref: refs/heads/main\n');
  h.save(join(directory, 'HEAD'), 'ref: refs/heads/feature\n');
  h.save(join(directory, 'commondir'), '../..');
  h.save(join(worktree, '.git'), `gitdir: ${relative(worktree, directory)}\n`);
}

test('global then root-to-cwd ancestors, without siblings, descendants, or dependency discovery', async t => {
  const h = setup(t);
  h.save(join(h.global, 'AGENTS.md'), 'GLOBAL');
  h.save(join(h.root, 'AGENTS.md'), 'ANCESTOR');
  h.save(join(h.cwd, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  h.save(join(h.cwd, 'AGENTS.md'), 'PROJECT');
  h.save(join(h.root, 'flame', 'AGENTS.md'), 'SIBLING');
  h.save(join(h.cwd, 'src', 'AGENTS.md'), 'NESTED');
  h.save(join(h.cwd, 'node_modules', 'library', 'AGENTS.md'), 'DEPENDENCY');
  assert.deepEqual(h.own(await h.load()).map(file => file.content), ['GLOBAL', 'ANCESTOR', 'PROJECT']);
  assert.deepEqual(h.own(await h.load(join(h.cwd, 'src'))).map(file => file.content), ['GLOBAL', 'ANCESTOR', 'PROJECT', 'NESTED']);
});

test('filename priority and empty overrides preserve other directories while replacing local fallbacks', async t => {
  const h = setup(t), names = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];
  h.save(join(h.root, 'AGENTS.md'), 'ANCESTOR');
  for (const name of names) h.save(join(h.cwd, name), name);
  for (const name of names) {
    const files = h.own(await h.load());
    assert.deepEqual(files.map(file => file.content), ['ANCESTOR', name]);
    rmSync(join(h.cwd, name));
  }
  h.save(join(h.cwd, 'AGENTS.md'), 'FALLBACK'); h.save(join(h.cwd, 'AGENTS.override.md'), '');
  assert.deepEqual(h.own(await h.load()).map(file => file.content), ['ANCESTOR', '']);
});

test('global instructions are included once if their directory is also an ancestor', async t => {
  const h = setup(t); h.save(join(h.root, 'AGENTS.md'), 'GLOBAL'); h.save(join(h.cwd, 'AGENTS.md'), 'PROJECT');
  assert.deepEqual(h.own(await h.load(h.cwd, h.root)).map(file => file.content), ['GLOBAL', 'PROJECT']);
});

test('non-files are skipped, BOM is stripped, and source content is not rewritten in the prompt', async t => {
  const h = setup(t); mkdirSync(join(h.cwd, 'AGENTS.override.md'));
  const content = '<rules>Keep && and <markup> intact.</rules>';
  h.save(join(h.cwd, 'AGENTS.md'), `\uFEFF${content}`);
  const files = h.own(await h.load());
  assert.equal(files[0].content, content); assert.deepEqual(h.warnings, []);
  assert.equal(formatProjectContext(files), `<project_context>\nProject-specific instructions and guidelines:\n\n<project_instructions path="${files[0].path}">\n${content}\n</project_instructions>\n</project_context>`);
  assert.equal(formatProjectContext([]), '');
});

test('instruction symlinks are followed and missing link targets allow the next candidate', { skip: process.platform === 'win32' }, async t => {
  const h = setup(t); h.save(join(h.root, 'shared.md'), 'SHARED');
  symlinkSync(join(h.root, 'missing'), join(h.cwd, 'AGENTS.override.md'));
  symlinkSync(join(h.root, 'shared.md'), join(h.cwd, 'AGENTS.md'));
  assert.equal(h.own(await h.load()).at(-1).content, 'SHARED');
  assert.deepEqual(h.warnings, []);
});

test('unreadable candidate warns and falls back instead of failing the run', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const h = setup(t), path = join(h.cwd, 'AGENTS.override.md');
  h.save(path, 'UNREADABLE'); h.save(join(h.cwd, 'AGENTS.md'), 'FALLBACK'); chmodSync(path, 0);
  try {
    assert.equal(h.own(await h.load()).at(-1).content, 'FALLBACK');
    assert.ok(h.warnings.some(message => message.includes('AGENTS.override.md')));
  } finally { chmodSync(path, 0o600); }
});

test('no custom instruction-size or strict-decoding policy is imposed', async t => {
  const h = setup(t), path = join(h.cwd, 'AGENTS.md');
  h.save(path, 'x'.repeat(300 * 1024));
  assert.equal(h.own(await h.load()).at(-1).content.length, 300 * 1024);
  h.save(path, Buffer.from([0xff]));
  assert.equal(h.own(await h.load()).at(-1).content, '\ufffd');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadProjectContextFiles({ cwd: h.cwd, agentDir: h.global, signal: controller.signal }));
});

test('nested linked worktrees shadow only the same filename at the main checkout root', async t => {
  const h = setup(t), worktree = join(h.cwd, 'worktrees', 'feature'), src = join(worktree, 'src');
  mkdirSync(src, { recursive: true }); linked(h, h.cwd, worktree);
  h.save(join(h.root, 'AGENTS.md'), 'OUTER'); h.save(join(h.cwd, 'AGENTS.md'), 'MAIN');
  h.save(join(worktree, 'AGENTS.md'), 'WORKTREE'); h.save(join(src, 'AGENTS.md'), 'SOURCE');
  assert.deepEqual(h.own(await h.load(src)).map(file => file.content), ['OUTER', 'WORKTREE', 'SOURCE']);
  rmSync(join(worktree, 'AGENTS.md'));
  assert.deepEqual(h.own(await h.load(src)).map(file => file.content), ['OUTER', 'MAIN', 'SOURCE']);
  rmSync(join(h.cwd, 'AGENTS.md')); h.save(join(h.cwd, 'CLAUDE.md'), 'OTHER_NAME'); h.save(join(worktree, 'AGENTS.md'), 'WORKTREE');
  assert.deepEqual(h.own(await h.load(src)).map(file => file.content), ['OUTER', 'OTHER_NAME', 'WORKTREE', 'SOURCE']);
});

test('sibling worktrees do not load the main checkout instructions', async t => {
  const h = setup(t), sibling = join(h.root, 'feature'); linked(h, h.cwd, sibling);
  h.save(join(h.root, 'AGENTS.md'), 'OUTER'); h.save(join(h.cwd, 'AGENTS.md'), 'MAIN'); h.save(join(sibling, 'AGENTS.md'), 'FEATURE');
  assert.deepEqual(h.own(await h.load(sibling)).map(file => file.content), ['OUTER', 'FEATURE']);
});

test('bare layouts, submodules, and invalid git metadata retain normal ancestor inheritance', async t => {
  const h = setup(t), worktree = join(h.cwd, 'feature'); linked(h, h.cwd, worktree, join(h.cwd, '.bare'));
  h.save(join(h.cwd, 'AGENTS.md'), 'CONTAINER'); h.save(join(worktree, 'AGENTS.md'), 'WORKTREE');
  assert.deepEqual(h.own(await h.load(worktree)).map(file => file.content), ['CONTAINER', 'WORKTREE']);
  const module = join(h.cwd, 'vendor', 'library'), metadata = join(h.cwd, '.git', 'modules', 'library');
  h.save(join(metadata, 'HEAD'), 'ref: refs/heads/main\n'); h.save(join(module, '.git'), `gitdir: ${metadata}\n`);
  h.save(join(module, 'AGENTS.md'), 'MODULE');
  assert.deepEqual(h.own(await h.load(module)).map(file => file.content), ['CONTAINER', 'MODULE']);
  h.save(join(module, '.git'), `gitdir: ${join(h.root, 'missing')}\n`);
  assert.deepEqual(h.own(await h.load(module)).map(file => file.content), ['CONTAINER', 'MODULE']);
});
