import HighlightWorker from "./highlight.worker?worker";
export type Token = { text: string; color?: string; fontStyle?: number };
export type Highlight = Token[][] | null;
let worker: Worker | undefined, nextId = 0, cacheSize = 0;
const cache = new Map<string, { lines: Highlight; size: number }>();
const pending = new Map<number, { resolve: (lines: Highlight) => void; timer: ReturnType<typeof setTimeout>; key: string }>();
const requests = new Map<string, Promise<Highlight>>();
function reset() {
  worker?.terminate(); worker = undefined;
  for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(null); }
  pending.clear(); requests.clear();
}
function remember(key: string, lines: Highlight) {
  const size = key.length * 2 + (lines?.reduce((sum, line) => sum + line.reduce((n, token) => n + token.text.length * 2 + 100, 0), 0) ?? 0);
  if (size > 2 * 1024 * 1024) return;
  cache.set(key, { lines, size }); cacheSize += size;
  while (cache.size > 64 || cacheSize > 2 * 1024 * 1024) {
    const oldest = cache.entries().next().value!; cacheSize -= oldest[1].size; cache.delete(oldest[0]);
  }
}
export function highlight(code: string, language: string): Promise<Highlight> {
  if (!language || code.length > 128 * 1024) return Promise.resolve(null);
  const key = `${language}\0${code}`;
  const saved = cache.get(key);
  if (saved) { cache.delete(key); cache.set(key, saved); return Promise.resolve(saved.lines); }
  const existing = requests.get(key); if (existing) return existing;
  if (pending.size >= 64) return Promise.resolve(null);
  try {
    if (!worker) {
      worker = new HighlightWorker();
      worker.onerror = reset;
      worker.onmessageerror = reset;
      worker.onmessage = (event: MessageEvent<{ id: number; lines: Highlight }>) => {
        const request = pending.get(event.data.id); if (!request) return;
        clearTimeout(request.timer); pending.delete(event.data.id); requests.delete(request.key);
        remember(request.key, event.data.lines); request.resolve(event.data.lines);
      };
    }
    const id = ++nextId;
    const promise = new Promise<Highlight>(resolve => {
      // A stuck grammar must not freeze the chat. This only bounds highlighting.
      pending.set(id, { resolve, key, timer: setTimeout(reset, 10_000) });
    });
    requests.set(key, promise);
    worker.postMessage({ id, code, language });
    return promise;
  } catch { reset(); return Promise.resolve(null); }
}
