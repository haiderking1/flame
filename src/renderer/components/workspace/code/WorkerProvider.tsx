import { useEffect, useState, type ReactNode } from "react";
import { WorkerPoolContext } from "@pierre/diffs/react";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { acquireCodePool, disposeCodePool, releaseCodePool } from "./workerPool";
export function WorkerProvider({ children }: { children(plain: boolean): ReactNode }) {
  const [pool, setPool] = useState<WorkerPoolManager>();
  const [ready, setReady] = useState(false), [plain, setPlain] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const entry = acquireCodePool(); let alive = true;
    setPool(entry.pool); setReady(false); setPlain(false);
    const fail = () => { if (alive) { setPlain(true); setReady(true); } };
    entry.listeners.add(fail);
    const unsubscribe = entry.pool.subscribeToStatChanges(stats => { if (alive && stats.workersFailed) fail(); });
    if (entry.failed) fail();
    else void entry.pool.initialize().then(() => { if (alive) { setReady(true); setPlain(entry.failed || !entry.pool.isWorkingPool()); } }, fail);
    return () => { alive = false; entry.listeners.delete(fail); unsubscribe(); releaseCodePool(entry); };
  }, [retry]);
  return <WorkerPoolContext value={plain ? undefined : pool}>
    {plain && <p className="diff-view__notice" role="status">Syntax highlighting unavailable. Source is still readable.<button onClick={() => { disposeCodePool(); setRetry(value => value + 1); }}>Retry highlighting</button></p>}
    {ready ? children(plain) : <p className="diff-panel__empty" role="status">Preparing code viewer…</p>}
  </WorkerPoolContext>;
}
