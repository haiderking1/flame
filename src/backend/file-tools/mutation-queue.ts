const pending = new Map<string, Promise<void>>();

/** Process-wide, canonical-path serialization across sessions and project aliases. */
export async function withFileLock<T>(path: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  const prior = pending.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = prior.then(() => gate);
  pending.set(path, tail);
  await prior;
  try { signal.throwIfAborted(); return await work(); }
  finally {
    release();
    if (pending.get(path) === tail) pending.delete(path);
  }
}
