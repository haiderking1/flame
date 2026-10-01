import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeLatestPage, prependPage } from '../src/renderer/components/sessions/historyPages.ts';
import { shareJobs } from '../src/renderer/components/sessions/work/rowSharing.ts';
import { adjustNestedSize } from '../src/renderer/components/virtual/scrollSizing.ts';
const entry = (id, parentId = null) => ({ id, parentId, kind: 'user', text: id, settings: null, createdAt: 0 });
test('history refresh retains older pages and immutable row references; stale prepends cannot duplicate rows', () => {
  const a = entry('a'), b = entry('b', 'a'), c = entry('c', 'b'), d = entry('d', 'c');
  const old = { entries: [a, b, c], nextBefore: 'a' };
  const result = mergeLatestPage(old, { entries: [{ ...c }, d], nextBefore: 'c' });
  assert.deepEqual(result.entries, [a, b, c, d]); assert.equal(result.entries[2], c); assert.equal(result.nextBefore, 'a');
  assert.deepEqual(mergeLatestPage(old, { entries: [d], nextBefore: 'd' }).entries, [a, b, c, d]);
  const branch = { entries: [entry('other')], nextBefore: null }; assert.equal(mergeLatestPage(old, branch), branch);
  const older = { entries: [entry('z'), { ...a }], nextBefore: null };
  const prepended = prependPage(old, older, 'a'); assert.equal(prepended.entries.filter(item => item.id === 'a').length, 1); assert.equal(prepended.entries[1], a);
  assert.equal(prependPage(prepended, older, 'a'), prepended);
});
test('job snapshots preserve unchanged member and array identity', () => {
  const a = { id: 'a', turnId: '1', text: 'same', status: 'running' }, b = { id: 'b', turnId: '2', text: 'same', status: 'running' }, previous = [a, b];
  assert.equal(shareJobs(previous, [{ ...a }, { ...b }]), previous);
  const updated = shareJobs(previous, [{ ...a }, { ...b, text: 'new' }]); assert.equal(updated[0], a); assert.notEqual(updated[1], b);
});
test('nested size compensation preserves the visible anchor without double-counting an enclosing row', () => {
  const item = { key:'row', start:100, end:150, size:50, index:0, lane:0 };
  const instance = { scrollElement:{getBoundingClientRect:()=>({top:0}),clientTop:0},scrollOffset:200,scrollDirection:'forward',itemSizeCache:new Map([['row',50]]) };
  const root = {parentElement:{closest:()=>null}};
  assert.equal(adjustNestedSize(item,instance,root),true);
  assert.equal(adjustNestedSize({...item,end:350},instance,root),false,'growth below the fold must not pull the reader');
  instance.scrollDirection='backward'; assert.equal(adjustNestedSize(item,instance,root),false);
  instance.scrollDirection='forward'; instance.itemSizeCache.clear(); assert.equal(adjustNestedSize({...item,end:350},instance,root),true);
  const enclosing = {parentElement:null,getBoundingClientRect:()=>({bottom:-5})};
  assert.equal(adjustNestedSize(item,instance,{parentElement:{closest:()=>enclosing}}),false,'the enclosing measured row owns this correction');
});
