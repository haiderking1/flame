import assert from 'node:assert/strict';
import test from 'node:test';
import { AstBudget } from '../src/renderer/components/workspace/code/AstBudget.ts';
import { superviseWorker } from '../src/renderer/components/workspace/code/workerHealth.ts';
import { codePoolSize } from '../src/renderer/components/workspace/code/cacheBudget.ts';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import { canColorSource, CODE_TOKENIZE_CHARACTERS, CODE_TOKENIZE_LINES } from '../src/renderer/components/workspace/code/highlightPolicy.ts';
test('file and diff caches share a byte budget across reuse, replacement, theme invalidation and oversized results', () => {
  const budget = new AstBudget(1000), file = new Map(), diff = new Map();
  file.set('file:dark', { source: 'x'.repeat(250) }); diff.set('diff:dark', { source: 'y'.repeat(250) });
  const result = budget.trim([file,diff]); assert.equal(file.size, 0); assert.equal(diff.size, 1); assert.ok(result.bytes <= 1000);
  assert.deepEqual(budget.trim([file,diff]), result, 'reuse has stable accounting');
  diff.clear(); diff.set('diff:light', { source: 'z'.repeat(100) }); const changed = budget.trim([file,diff]); assert.ok(changed.bytes < result.bytes);
  diff.set('diff:huge', { source: 'z'.repeat(2000) }); assert.deepEqual(budget.trim([file,diff]), { bytes: 0, entries: 0 });
  assert.throws(() => new AstBudget(-1));
  assert.equal(canColorSource('x'.repeat(CODE_TOKENIZE_CHARACTERS)),true); assert.equal(canColorSource('x'.repeat(CODE_TOKENIZE_CHARACTERS+1)),false);
  assert.equal(canColorSource('x\n'.repeat(CODE_TOKENIZE_LINES)),false); assert.equal(canColorSource('old','new'),true);
  assert.equal(codePoolSize(12,8),2); assert.equal(codePoolSize(2,8),1); assert.equal(codePoolSize(12,2),1); assert.equal(codePoolSize(12),1);
});
class WorkerMock extends EventTarget {
  sent = []; stopped = false;
  postMessage(message) { this.sent.push(message); }
  terminate() { this.stopped = true; }
}
test('worker supervision clears response deadlines, detects runtime/message errors and cleans up timers', async () => {
  let failures = 0; const raw = new WorkerMock(), worker = superviseWorker(raw, () => { failures++; worker.terminate(); }, 15);
  worker.postMessage({ id: 'ready', type: 'initialize' }); worker.dispatchEvent(new MessageEvent('message', { data: { id: 'ready', type: 'success' } }));
  await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(failures, 0);
  worker.postMessage({ id: 'stuck', type: 'file' }); await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(failures, 1); assert.equal(worker.stopped, true);
  worker.dispatchEvent(new Event('error')); assert.equal(failures, 1, 'terminated workers cannot fail a later generation');
  let messageErrors = 0; const bad = new WorkerMock(), watched = superviseWorker(bad, () => { messageErrors++; watched.terminate(); }, 15);
  watched.postMessage({ id: 'file' }); watched.dispatchEvent(new Event('messageerror')); await new Promise(resolve => setTimeout(resolve,25)); assert.equal(messageErrors, 1);
});
test('diff worker cache identity distinguishes filename/language and renamed source paths', async () => {
  const replies=[]; const previous=globalThis.self;
  globalThis.self={postMessage:message=>replies.push(message)};
  try {
    await import('../src/renderer/components/workspace/code/parse.worker.ts');
    const request={before:'let x=1;\n',after:'let x=2;\n',version:'same-content'};
    for (const [id,path,beforePath] of [[1,'source.ts','source.ts'],[2,'source.json','source.json'],[3,'source.ts','source.rs']]) self.onmessage({data:{id,path,beforePath,...request}});
    assert.equal(replies.length,3); assert.equal(new Set(replies.map(reply=>reply.diff.cacheKey)).size,3);
    assert.equal(replies[2].diff.prevName,'source.rs'); assert.equal(replies[2].diff.name,'source.ts');
  } finally { if (previous === undefined) delete globalThis.self; else globalThis.self=previous; }
});
test('worker render caches invalidate across actual theme and tokenization-option changes', async () => {
  class ReadyWorker extends WorkerMock { postMessage(message) { super.postMessage(message); queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:message.id,type:'success',requestType:message.type}}))); } }
  const raf=globalThis.requestAnimationFrame, cancel=globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame=callback=>setTimeout(()=>callback(performance.now()),0); globalThis.cancelAnimationFrame=clearTimeout;
  const pool=new WorkerPoolManager({workerFactory:()=>new ReadyWorker(),poolSize:1,totalASTLRUCacheSize:12,workerInitializationTimeout:1000},{theme:'github-dark',preferredHighlighter:'shiki-wasm'});
  try {
    await pool.initialize();
    let caches=pool.inspectCaches(); caches.fileCache.set('same-source',{}); caches.diffCache.set('same-source',{});
    await pool.setRenderOptions({theme:'github-light'});
    assert.equal(caches.fileCache.size,0); assert.equal(caches.diffCache.size,0);
    caches.fileCache.set('same-source',{}); await pool.setRenderOptions({theme:'github-dark',tokenizeMaxLineLength:500}); assert.equal(caches.fileCache.size,0);
  } finally { pool.terminate(); await new Promise(resolve=>setTimeout(resolve,10)); if(raf) globalThis.requestAnimationFrame=raf; else delete globalThis.requestAnimationFrame; if(cancel) globalThis.cancelAnimationFrame=cancel; else delete globalThis.cancelAnimationFrame; }
});
