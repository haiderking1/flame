import assert from 'node:assert/strict';
import test from 'node:test';
import { matchingCommands, slashQuery } from '../src/renderer/components/composer/slash/commands.ts';

test('standalone slash prefixes match commands without expanding the composer draft', () => {
  for (const draft of ['/', '/c', '/com', '/compact', ' /COMPACT ']) {
    const query = slashQuery(draft);
    assert.notEqual(query, null);
    assert.deepEqual(matchingCommands(query).map(command => command.text), ['/compact']);
  }
  assert.deepEqual(matchingCommands(slashQuery('/unknown')), []);
  assert.deepEqual(matchingCommands(slashQuery('/compaction')), []);
});

test('slash paths, prose, and multiline requests remain normal messages', () => {
  for (const draft of ['', 'hello', '/tmp/project.txt', '/home', '/compact this please',
    '/compact\ncontinue', 'review /compact', '/compact.md', '/path/to/file', '//comment', '/123']) {
    // A lone alphabetic token is reserved, including an unknown command like /home.
    if (draft === '/home') assert.equal(slashQuery(draft), 'home');
    else assert.equal(slashQuery(draft), null, draft);
  }
});
