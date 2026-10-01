import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { fileWork } from '../dist/backend/turns/file-work.js';
register('./helpers/contracts-alias.mjs', import.meta.url);
const { resolveFileIcon, fileIconColor, languageFileName, hasLanguageIcon } = await import('../src/renderer/components/files/fileIcons.ts');
const { filePathFromHref } = await import('../src/renderer/components/markdown/fileLink.ts');

test('file icons resolve by name, then extension, with T3 overrides and a generic fallback', () => {
  const token = path => resolveFileIcon(path).token;
  assert.equal(token('src/app.ts'), 'typescript'); assert.equal(token('main.rs'), 'rust'); assert.equal(token('a/b/README.md'), 'markdown');
  assert.equal(token('Dockerfile'), 'docker'); assert.equal(token('.gitignore'), 'git'); assert.equal(token('Component.tsx'), 'react');
  assert.deepEqual(resolveFileIcon('package.json'), { name: 'file-tree-builtin-npm', token: 'npm' }, 'name rules take precedence over the extension');
  assert.deepEqual(resolveFileIcon('AGENTS.md'), { name: 'flame-file-icon-agents', token: 'agents' });
  assert.equal(token('clip.MP4'), 'video'); assert.equal(token('pnpm-lock.yaml'), 'pnpm');
  assert.deepEqual(resolveFileIcon('notes.unknownext'), { name: 'file-tree-builtin-default', token: 'default' });
  assert.equal(fileIconColor('typescript'), '#69b1ff'); assert.equal(fileIconColor('not-a-token'), fileIconColor('default'));
});

test('code fence languages map to file icons, and languages without one keep their name', () => {
  assert.equal(languageFileName('TypeScript'), 'file.ts'); assert.equal(languageFileName('bash'), 'file.sh'); assert.equal(languageFileName('go'), 'file.go');
  for (const language of ['ts', 'typescript', 'python', 'rust', 'json', 'bash', 'tsx', 'yaml', 'css', 'html', 'markdown']) assert.ok(hasLanguageIcon(language), language);
  for (const language of ['', '  ', 'diff', 'mermaid', 'nonsense']) assert.equal(hasLanguageIcon(language), false, language);
});

test('markdown links are treated as files only when they reference a path', () => {
  assert.deepEqual(filePathFromHref('src/app.ts'), { path: 'src/app.ts', directory: false });
  assert.deepEqual(filePathFromHref('src/app.ts:12:4'), { path: 'src/app.ts', directory: false });
  assert.deepEqual(filePathFromHref('app.ts:12'), { path: 'app.ts', directory: false });
  assert.deepEqual(filePathFromHref('/home/me/a%20b.md#L3'), { path: '/home/me/a b.md', directory: false });
  assert.deepEqual(filePathFromHref('file:///tmp/x.rs'), { path: '/tmp/x.rs', directory: false });
  assert.deepEqual(filePathFromHref('src/components/'), { path: 'src/components', directory: true });
  assert.deepEqual(filePathFromHref('.env'), { path: '.env', directory: false });
  assert.deepEqual(filePathFromHref('C:\\code\\main.c'), { path: 'C:\\code\\main.c', directory: false });
  for (const href of [undefined, '', '#heading', 'mailto:a@b.c', 'javascript:alert(1)', 'vscode://x', 'README', '.', '/']) assert.equal(filePathFromHref(href), null, String(href));
});

test('file tool steps carry the requested path for their icon, and only a valid one', () => {
  assert.equal(fileWork('read', { path: 'src/a.ts' }, undefined, 'running').file.path, 'src/a.ts');
  assert.equal(fileWork('ls', {}, undefined, 'running').file.path, '.');
  const invalid = fileWork('edit', { path: 42 }, undefined, 'running');
  assert.equal(invalid.command, 'Edit (invalid path)'); assert.equal('path' in invalid.file, false);
});
