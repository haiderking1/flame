import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
import { getSchema, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { mentionNames } from '../dist/contracts/file-mentions.js';
register('./helpers/contracts-alias.mjs', import.meta.url);
const { serializeFileMention, findFileMentions, detectMentionTrigger, basename } = await import('../src/renderer/components/composer/mentions/mentionSyntax.ts');
const { promptToDoc, docToPrompt, offsetAt, posAt, MENTION_NODE } = await import('../src/renderer/components/composer/editor/promptDoc.ts');

test('mentions serialize to file links that parse back, including folders and awkward names', () => {
  assert.equal(serializeFileMention('src/app.ts'), '[app.ts](src/app.ts)');
  assert.equal(serializeFileMention('src/components', true), '[components](src/components/)');
  assert.equal(serializeFileMention('docs/my notes (draft)#1?.md'), '[my notes (draft)#1?.md](docs/my%20notes%20%28draft%29%231%3F.md)');
  assert.equal(serializeFileMention('a/[x].ts'), '[\\[x\\].ts](a/%5Bx%5D.ts)');
  for (const [path, directory] of [['src/app.ts', false], ['src/components', true], ['docs/my notes (draft)#1?.md', false], ['a/[x].ts', false], ['ünïcode/файл.rs', false]]) {
    const text = `see ${serializeFileMention(path, directory)} now`;
    const [mention] = findFileMentions(text);
    assert.deepEqual({ path: mention.path, directory: mention.directory }, { path, directory }, path);
    assert.equal(text.slice(mention.start, mention.end), mention.source);
  }
  assert.equal(basename('a\\b\\c.ts'), 'c.ts');
});

test('only links whose label is the basename become mentions', () => {
  assert.equal(findFileMentions('[docs](https://example.com/docs) [x](y.ts) [y.ts](https://e.com/y.ts) [a.ts](a.ts)').map(m => m.path).join(), 'a.ts');
  assert.equal(findFileMentions('word[a.ts](a.ts)').length, 0, 'a mention starts at whitespace or the start');
  assert.equal(findFileMentions('[a.ts](a.ts)').length, 1, 'a mention may end the text');
  assert.equal(findFileMentions(' ['.repeat(5000)).length, 0);
  assert.equal(mentionNames('Fix [app.ts](src/app.ts) and [lib](src/lib/) please'), 'Fix app.ts and lib please');
});

test('the @ trigger is the whitespace-delimited token at the caret', () => {
  assert.deepEqual(detectMentionTrigger('open @src/ap', 12), { query: 'src/ap', start: 5, end: 12 });
  assert.deepEqual(detectMentionTrigger('@', 1), { query: '', start: 0, end: 1 });
  assert.deepEqual(detectMentionTrigger('a\n@x y', 4), { query: 'x', start: 2, end: 4 });
  assert.equal(detectMentionTrigger('mail me@host', 12), null);
  assert.equal(detectMentionTrigger('@x y', 4), null, 'the token ends at whitespace');
  assert.equal(detectMentionTrigger('@abc', 0), null);
});

const schema = getSchema([Document, Paragraph, Text, Node.create({ name: MENTION_NODE, group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ path: { default: '' }, directory: { default: false }, source: { default: '' } }) })]);
const doc = text => schema.nodeFromJSON(promptToDoc(text));

test('prompt text round-trips through the editor document with chips as atoms', () => {
  for (const text of ['', 'plain', 'two\nlines', '\n\nblank lines\n', 'see [a.ts](src/a.ts) and [lib](lib/)\nnext [b.ts](b.ts)', '[a.ts](a.ts)']) assert.equal(docToPrompt(doc(text)), text, JSON.stringify(text));
  const node = doc('x [a.ts](src/a.ts) y');
  const chip = node.firstChild.child(1);
  assert.equal(chip.type.name, MENTION_NODE); assert.equal(chip.attrs.path, 'src/a.ts');
});

test('caret offsets map between prompt text and document positions, never inside a chip', () => {
  const text = 'ab [a.ts](a.ts) c\nde', node = doc(text);
  const link = '[a.ts](a.ts)';
  for (const offset of [0, 1, 2, 3, 3 + link.length, 3 + link.length + 2, text.length - 2, text.length]) assert.equal(offsetAt(node, posAt(node, offset)), offset, `offset ${offset}`);
  assert.equal(offsetAt(node, posAt(node, 5)), 3 + link.length, 'an offset inside the link lands after the chip');
  assert.equal(posAt(node, 999), node.content.size);
});
