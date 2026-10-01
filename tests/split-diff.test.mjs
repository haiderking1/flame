import assert from 'node:assert/strict';
import test from 'node:test';
import { splitDisplayDiff } from '../src/renderer/components/workspace/code/splitDiff.ts';

const diff = type => ({ name: 'a.ts', type, hunks: [], additionLines: [], deletionLines: [], splitLineCount: 0, unifiedLineCount: 0, cacheKey: 'k' });
test('split view presents added and deleted files as two-column changes with distinct cache keys', () => {
  for (const type of ['new', 'deleted']) {
    const shown = splitDisplayDiff(diff(type), 'split');
    assert.equal(shown.type, 'change');
    assert.equal(shown.cacheKey, `k:split-${type}`);
    assert.equal(splitDisplayDiff(diff(type), 'unified').type, type, 'unified view is untouched');
  }
  for (const type of ['change', 'rename-pure', 'rename-changed']) { const original = diff(type); assert.equal(splitDisplayDiff(original, 'split'), original); }
  const { cacheKey: _omitted, ...uncached } = diff('new');
  assert.equal('cacheKey' in splitDisplayDiff(uncached, 'split'), false);
});
