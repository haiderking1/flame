import assert from 'node:assert/strict';
export function percentile(values, p = .95) { if (!values.length) return 0; const sorted = [...values].sort((a,b) => a-b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
export function checkBudgets(report) {
  assert.equal(report.startup.length,3);
  assert.ok(report.ui.allReactCommitMs.length > 10 && report.ui.allReactRenderMs.length > 10, 'production profiling traces are missing');
  assert.ok(['initialize','diff','chat'].every(type => report.ui.workerRoundTrips.some(sample => sample.type === type)), 'real worker round-trip samples are missing');
  assert.ok(report.startup.every(sample => Number.isFinite(sample.firstUsableMs) && sample.firstUsableMs > 0 && sample.firstUsableMs < 2500), 'cold startup exceeds 2.5 seconds');
  assert.ok(report.ui.firstPanelMs < 4000, 'first panel open exceeds four seconds');
  assert.ok(percentile([...report.ui.inputLatenciesMs,...report.ui.panelInputLatenciesMs,...report.ui.searchInputLatenciesMs]) < 50, 'input-to-next-frame p95 exceeds 50 ms');
  assert.ok(percentile(report.ui.allReactCommitMs) < 20, 'timeline commit p95 exceeds 20 ms');
  assert.ok(percentile(report.ui.scrollFrameMs) < 75, 'two-frame scroll response p95 exceeds 75 ms');
  assert.ok(report.ui.chatNodes > 0 && report.ui.chatNodes < 1500 && report.ui.chatCodeNodes < 1500 && report.ui.codeNodes > 0 && report.ui.codeNodes < 15_000, 'virtualized DOM exceeds its measured envelope');
  assert.ok(report.ui.heapAfterIdle.usedSize < 96 * 1024 * 1024, 'retained renderer heap after cleanup exceeds 96 MiB');
  assert.equal(report.ui.draftWrites, 1, 'sustained typing produced more than one draft write');
  for (const [language, sample] of Object.entries(report.highlighting.samples)) assert.ok(sample.warmMedianMs < 25, `${language} warm highlighting exceeded 25 ms`);
}
