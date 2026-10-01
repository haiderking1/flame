import assert from 'node:assert/strict';
import test from 'node:test';
import { createHighlightEngine, normalizeLanguage } from '../src/renderer/components/markdown/highlighting/engine.ts';
import { createHighlightClient } from '../src/renderer/components/markdown/highlighting/client.ts';
import { highlightBytes, CHAT_CACHE_BYTES } from '../src/renderer/components/markdown/highlighting/types.ts';
import { ByteLru } from '../src/renderer/lib/ByteLru.ts';
import { retainedBytes, codePoolSize } from '../src/renderer/components/workspace/code/cacheBudget.ts';

function engineMock() {
  const loaded = new Set(); let loads = 0, fails = 0;
  return { engine: { getLoadedLanguages: () => [...loaded], loadLanguage: async lang => { loads++; await Promise.resolve(); if (fails > 0) { fails--; throw new Error('load'); } loaded.add(lang); }, codeToTokens: code => ({ tokens: [[{ content: code, color: '#123456', fontStyle: 2 }]] }) }, loaded, get loads() { return loads; }, fail() { fails++; } };
}
test('highlighter initialization and language loads are shared, retryable, and unknown languages stay plain', async () => {
  const mock = engineMock(); let initializations = 0;
  const highlight = createHighlightEngine(async () => { initializations++; if (initializations === 1) throw new Error('WASM'); return mock.engine; });
  assert.equal(await highlight('unknown', 'not-a-language'), null);
  assert.equal(initializations, 0);
  assert.equal(await highlight('retry me', 'ts'), null);
  const result = await Promise.all(Array.from({ length: 20 }, () => highlight('const a = 1;', 'typescript')));
  assert.equal(initializations, 2); assert.equal(mock.loads, 1); assert.ok(result.every(lines => lines[0][0].text === 'const a = 1;'));
  mock.fail(); assert.equal(await highlight('{}', 'json'), null);
  assert.ok(await highlight('{}', 'json')); assert.equal(mock.loads, 3);
  assert.equal(normalizeLanguage(' BASH '), 'shellscript'); assert.equal(normalizeLanguage('__proto__'),'__proto__');
  assert.equal(await highlight('unknown','constructor'),null);
});
test('real Oniguruma highlighting covers Rust, TSX, JSON, shell, embedded grammars and multiline code', async () => {
  const highlight = createHighlightEngine();
  for (const [lang, code] of [['rust', 'fn main() {\n /* comment\n */ println!("hello");\n}'], ['tsx', 'const node = <div>{`hello\nworld`}</div>;'], ['json', '{"valid":true,"n":42}'], ['bash', 'echo "$HOME"\n# comment'], ['html', '<script>const n = 42;</script>']]) {
    const lines = await highlight(code, lang); assert.ok(lines, lang); assert.equal(lines.map(line => line.map(token => token.text).join('')).join('\n'), code);
    assert.ok(new Set(lines.flat().map(token => token.color)).size > 1, lang);
  }
});
class WorkerMock {
  sent = []; terminated = false;
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(lines, id = this.sent.at(-1).id) { this.onmessage({ data: { id, lines } }); }
}
test('worker client deduplicates, bounds cache, retries failures and ignores old worker replies', async () => {
  const workers = [], client = createHighlightClient(() => { const worker = new WorkerMock(); workers.push(worker); return worker; }, 1000, 1000);
  try {
    const a = client.highlight('a', 'ts'), duplicate = client.highlight('a', 'ts'); assert.equal(a, duplicate);
    workers[0].reply(null); assert.equal(await a, null);
    const retry = client.highlight('a', 'ts'); workers[0].reply([[{ text: 'a' }]]); assert.ok(await retry);
    assert.ok(await client.highlight('a', 'ts')); assert.equal(workers[0].sent.length, 2);
    const broken = client.highlight('b', 'ts'); workers[0].onerror(); assert.equal(await broken, null); assert.ok(workers[0].terminated);
    const fresh = client.highlight('c', 'ts'); workers[0].reply([[{ text: 'stale' }]], workers[0].sent.at(-1).id); assert.equal(client.stats().pending, 1);
    workers[1].reply([[{ text: 'c' }]]); assert.deepEqual(await fresh, [[{ text: 'c' }]]);
    const nul = client.highlight('x\0y','rust'); workers[1].reply([[{text:'x\0y'}]]); await nul;
    const otherTuple = client.highlight('y','rust\0x'); assert.equal(client.stats().pending,1); workers[1].reply(null); assert.equal(await otherTuple,null);
    for (let index = 0; index < 200; index++) { const request = client.highlight(String(index), 'json'); workers[1].reply([[{ text: String(index) }]]); await request; }
    assert.equal(client.stats().entries, 128); assert.ok(client.stats().bytes <= CHAT_CACHE_BYTES);
  } finally { client.dispose(); }
});
test('worker timeout and idle teardown settle every request and allow reinitialization', async () => {
  const workers = [], client = createHighlightClient(() => { const worker = new WorkerMock(); workers.push(worker); return worker; }, 15, 15);
  try {
    const stuck = await Promise.all([client.highlight('a', 'ts'), client.highlight('b', 'json')]); assert.deepEqual(stuck, [null, null]);
    const retry = client.highlight('new', 'rust'); workers[1].reply([[{ text: 'new' }]]); await retry;
    await new Promise(resolve => setTimeout(resolve, 35)); assert.ok(workers[1].terminated); assert.equal(client.stats().worker, false);
  } finally { client.dispose(); }
});
test('LRU replacement, eviction, invalidation and conservative byte accounting', () => {
  const lru = new ByteLru(2, 10);
  lru.set('a', 1, 4); lru.set('b', 2, 4); lru.get('a'); lru.set('c', 3, 4); assert.equal(lru.get('b'), undefined); assert.equal(lru.bytes, 8);
  lru.set('a', 4, 2); assert.equal(lru.bytes, 6); lru.set('huge', 0, 11); assert.equal(lru.size, 2);
  lru.set('c', 5, 9); assert.equal(lru.get('a'), undefined); assert.equal(lru.bytes, 9);
  lru.clear(); assert.equal(lru.bytes, 0); assert.throws(() => lru.set('bad', 0, NaN));
  assert.ok(highlightBytes('a', [[{ text: 'hello', color: '#fff' }]]) > 100);
  const shared = { text: 'hello' }; assert.ok(retainedBytes([shared, shared]) < retainedBytes([{ text: 'hello' }, { text: 'hello' }]));
  const cycle = {}; cycle.self = cycle; assert.ok(Number.isFinite(retainedBytes(cycle)));
  assert.ok(retainedBytes('x'.repeat(1000), 100) > 100);
  assert.equal(codePoolSize(1, 8), 1); assert.equal(codePoolSize(64, 2), 1); assert.equal(codePoolSize(64, 8), 2);
});
