import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { AST_CACHE_BYTES, CODE_TOKENIZE_LINE, codePoolSize } from "./cacheBudget";
import { superviseWorker } from "./workerHealth";
import { AstBudget } from "./AstBudget";
export type PoolLease = { pool: WorkerPoolManager; consumers: number; failed: boolean; listeners: Set<() => void>; idle?: ReturnType<typeof setTimeout>; releaseBudget(): void };
let shared: PoolLease | undefined;
function enforceBudget(pool: WorkerPoolManager) {
  const budget = new AstBudget(AST_CACHE_BYTES);
  return pool.subscribeToStatChanges(() => { const { fileCache, diffCache } = pool.inspectCaches(); budget.trim([fileCache, diffCache]); });
}
export function acquireCodePool() {
  if (!shared) {
    let entry: PoolLease;
    const fail = () => {
      if (entry.failed) return;
      entry.failed = true; entry.pool.terminate();
      for (const listener of entry.listeners) listener();
    };
    const pool = new WorkerPoolManager({ workerFactory: () => superviseWorker(new DiffWorker(), fail),
      poolSize: codePoolSize(navigator.hardwareConcurrency, (navigator as Navigator & { deviceMemory?: number }).deviceMemory), totalASTLRUCacheSize: 12, workerInitializationTimeout: 10_000 },
      { theme: "pierre-dark", preferredHighlighter: "shiki-wasm", tokenizeMaxLineLength: CODE_TOKENIZE_LINE, useTokenTransformer: true, maxLineDiffLength: CODE_TOKENIZE_LINE });
    entry = { pool, consumers: 0, failed: false, listeners: new Set(), releaseBudget: enforceBudget(pool) };
    shared = entry;
  }
  clearTimeout(shared.idle); shared.consumers++; return shared;
}
export function releaseCodePool(entry: PoolLease) {
  if (--entry.consumers !== 0) return;
  entry.idle = setTimeout(() => { entry.releaseBudget(); entry.pool.terminate(); if (shared === entry) shared = undefined; }, 30_000);
}
export function disposeCodePool() { if (shared) { clearTimeout(shared.idle); shared.releaseBudget(); shared.pool.terminate(); shared = undefined; } }
window.addEventListener("pagehide", disposeCodePool);
if (import.meta.hot) import.meta.hot.dispose(disposeCodePool);
