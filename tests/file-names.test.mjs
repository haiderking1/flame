import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('no two tracked files differ only in letter case, which macOS and Windows checkouts cannot hold', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const seen = new Map(), clashes = [];
  for (const file of files) {
    const key = file.toLowerCase();
    if (seen.has(key)) clashes.push(`${seen.get(key)} / ${file}`); else seen.set(key, file);
  }
  assert.deepEqual(clashes, []);
});
