declare global { interface Window { __flamePerformance?: { rowRenders: Record<string, number>; commits: number[]; renders: number[] } } }
function trace() { return window.__flamePerformance ??= { rowRenders: {}, commits: [], renders: [] }; }
export function recordRowRender(id: string) {
  if (!import.meta.env.FLAME_PROFILE) return;
  const current = trace(); current.rowRenders[id] = (current.rowRenders[id] ?? 0) + 1;
}
export function recordCommit(_id: string, _phase: string, duration: number, _base: number, _start: number, commitTime: number) {
  if (!import.meta.env.FLAME_PROFILE) return;
  const current = trace();
  current.renders.push(duration); if (current.renders.length > 1000) current.renders.shift();
  // The end-of-task boundary conservatively includes synchronous layout effects
  // without relying on private React instrumentation hooks.
  queueMicrotask(() => { current.commits.push(performance.now() - commitTime); if (current.commits.length > 1000) current.commits.shift(); });
}
