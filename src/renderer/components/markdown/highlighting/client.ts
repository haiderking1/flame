import { ByteLru } from "../../../lib/ByteLru.ts";
import { CHAT_CACHE_BYTES, CHAT_CACHE_ENTRIES, CHAT_THEME, MAX_CODE_LENGTH, highlightBytes, type Highlight } from "./types.ts";

type Pending = { resolve: (lines: Highlight) => void; timer: ReturnType<typeof setTimeout>; key: string };
export function createHighlightClient(factory: () => Worker, timeout = 10_000, idleTime = 30_000) {
  let worker: Worker | undefined, nextId = 0, idle: ReturnType<typeof setTimeout> | undefined;
  const cache = new ByteLru<string, Exclude<Highlight, null>>(CHAT_CACHE_ENTRIES, CHAT_CACHE_BYTES);
  const pending = new Map<number, Pending>();
  const requests = new Map<string, Promise<Highlight>>();
  function reset() {
    clearTimeout(idle); idle = undefined;
    worker?.terminate(); worker = undefined;
    for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(null); }
    pending.clear(); requests.clear();
  }
  function scheduleIdle() { clearTimeout(idle); if (!pending.size) idle = setTimeout(reset, idleTime); }
  function highlight(code: string, language: string): Promise<Highlight> {
    if (!language || code.length > MAX_CODE_LENGTH) return Promise.resolve(null);
    const key = `tokens-v1\0${CHAT_THEME}\0${language.length}:${language}${code}`;
    const saved = cache.get(key); if (saved) return Promise.resolve(saved);
    const existing = requests.get(key); if (existing) return existing;
    if (pending.size >= 64) return Promise.resolve(null);
    clearTimeout(idle);
    try {
      if (!worker) {
        const instance = factory(); worker = instance;
        instance.onerror = () => { if (worker === instance) reset(); };
        instance.onmessageerror = () => { if (worker === instance) reset(); };
        instance.onmessage = (event: MessageEvent<{ id: number; lines: Highlight }>) => {
          if (worker !== instance) return;
          const request = pending.get(event.data.id); if (!request) return;
          clearTimeout(request.timer); pending.delete(event.data.id); requests.delete(request.key);
          const lines = event.data.lines;
          // Transient failures are not cached, so a visible block can retry later.
          if (lines) cache.set(request.key, lines, highlightBytes(request.key, lines));
          request.resolve(lines); scheduleIdle();
        };
      }
      const id = ++nextId;
      const promise = new Promise<Highlight>(resolve => { pending.set(id, { resolve, key, timer: setTimeout(reset, timeout) }); });
      requests.set(key, promise); worker.postMessage({ id, code, language });
      return promise;
    } catch { reset(); return Promise.resolve(null); }
  }
  return { highlight, dispose: () => { reset(); cache.clear(); }, stats: () => ({ entries: cache.size, bytes: cache.bytes, pending: pending.size, worker: !!worker }) };
}
