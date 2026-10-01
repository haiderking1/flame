import assert from 'node:assert/strict';
import test from 'node:test';
import { checkBudgets } from '../scripts/performance/budgets.mjs';
function report() {
  return { startup:Array.from({length:3},()=>({firstUsableMs:600})), ui:{firstPanelMs:600,inputLatenciesMs:Array(30).fill(6),panelInputLatenciesMs:[8],searchInputLatenciesMs:[8],allReactCommitMs:Array(20).fill(1),allReactRenderMs:Array(20).fill(2),workerRoundTrips:['initialize','diff','chat'].map(type=>({type,ms:10})),scrollFrameMs:[33,33,33,33],chatNodes:100,chatCodeNodes:1400,codeNodes:200,heapAfterIdle:{usedSize:20*1024**2},draftWrites:1}, highlighting:{samples:{rust:{warmMedianMs:4},tsx:{warmMedianMs:8},json:{warmMedianMs:2},shell:{warmMedianMs:2}}} };
}
test('performance budgets accept complete measurements, not missing profiling or worker evidence',()=>{
  assert.doesNotThrow(()=>checkBudgets(report()));
  for(const mutate of [r=>r.startup=[],r=>r.startup[0].firstUsableMs=NaN,r=>r.ui.allReactCommitMs=[],r=>r.ui.allReactRenderMs=[],r=>r.ui.workerRoundTrips=[]]) { const r=report(); mutate(r); assert.throws(()=>checkBudgets(r)); }
});
test('startup, input, commits, scrolling, DOM, retained heap, writes and highlighting have enforced regression thresholds',()=>{
  for(const mutate of [r=>r.startup[0].firstUsableMs=2500,r=>r.ui.firstPanelMs=4000,r=>r.ui.inputLatenciesMs.fill(50),r=>r.ui.allReactCommitMs.fill(20),r=>r.ui.scrollFrameMs.fill(75),r=>r.ui.chatNodes=1500,r=>r.ui.chatCodeNodes=1500,r=>r.ui.codeNodes=15_000,r=>r.ui.heapAfterIdle.usedSize=96*1024**2,r=>r.ui.draftWrites=2,r=>r.highlighting.samples.tsx.warmMedianMs=25]) { const r=report(); mutate(r); assert.throws(()=>checkBudgets(r)); }
});
