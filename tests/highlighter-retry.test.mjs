import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWasm } from '@shikijs/engine-oniguruma';
import { getSharedHighlighter, disposeHighlighter } from '@pierre/diffs';
test('actual WASM and file-view initialization failures release rejected promises and concurrent retry shares a real highlighter', async () => {
  let reject;
  const pending=loadWasm(new Promise((_,fail)=>{reject=fail;}));
  const options={themes:['github-dark'],langs:['text'],preferredHighlighter:'shiki-wasm'};
  const first=getSharedHighlighter(options), second=getSharedHighlighter(options);
  reject(new Error('Injected initial WASM load failure'));
  for(const result of await Promise.allSettled([pending,first,second])) assert.equal(result.status,'rejected');
  const [a,b]=await Promise.all([getSharedHighlighter({...options,langs:['rust']}),getSharedHighlighter({...options,langs:['rust']})]);
  assert.equal(a,b); assert.ok(a.getLoadedThemes().includes('github-dark'));
  assert.ok(a.codeToTokens('fn main() {}',{lang:'rust',theme:'github-dark'}).tokens.flat().some(token=>token.color));
  await disposeHighlighter();
});
