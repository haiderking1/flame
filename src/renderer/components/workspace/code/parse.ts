import type { FileDiffMetadata } from "@pierre/diffs";
import type { GitFileView } from "@contracts/git";
import ParserWorker from "./parse.worker?worker";
import { ByteLru } from "../../../lib/ByteLru";
import { retainedBytes } from "./cacheBudget";
const cache = new ByteLru<string, FileDiffMetadata>(16, 8 * 1024 * 1024);
let worker: Worker | undefined, nextId = 0, idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<number, { resolve(diff: FileDiffMetadata): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
const requests = new Map<string, Promise<FileDiffMetadata>>();
function reset() {
  clearTimeout(idle); worker?.terminate(); worker = undefined;
  for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("Diff computation was interrupted. Refresh to retry or switch to File.")); }
  pending.clear(); requests.clear();
}
export function parseFile(view: GitFileView): Promise<FileDiffMetadata> {
  const key = `${view.beforePath}\0${view.path}\0${view.mode}\0${view.version}`;
  const saved = cache.get(key); if (saved) return Promise.resolve(saved);
  const existing = requests.get(key); if (existing) return existing;
  if (pending.size >= 4) return Promise.reject(new Error("Diff viewer is busy. Wait for the current preview, then try again."));
  clearTimeout(idle);
  let request: Promise<FileDiffMetadata> | undefined;
  try {
    if (!worker) {
      const instance = new ParserWorker(); worker = instance;
      instance.onerror = () => { if (worker === instance) reset(); }; instance.onmessageerror = () => { if (worker === instance) reset(); };
      instance.onmessage = (event: MessageEvent<{ id: number; diff?: FileDiffMetadata; error?: string }>) => {
        if (worker !== instance) return;
        const task = pending.get(event.data.id); if (!task) return;
        pending.delete(event.data.id); clearTimeout(task.timer);
        if (event.data.diff) task.resolve(event.data.diff); else task.reject(new Error(event.data.error ?? "Diff computation failed."));
        if (!pending.size) idle = setTimeout(reset, 30_000);
      };
    }
    const id = ++nextId;
    const result = new Promise<FileDiffMetadata>((resolve, reject) => { pending.set(id, { resolve, reject, timer: setTimeout(reset, 10_000) }); });
    request = result.then(diff => { cache.set(key, diff, retainedBytes(diff, 8 * 1024 * 1024) + key.length * 2); return diff; }).finally(() => { if (requests.get(key) === request) requests.delete(key); });
    requests.set(key, request); worker.postMessage({ id, path: view.path, beforePath: view.beforePath, before: view.before, after: view.after, version: view.version });
    return request;
  } catch { reset(); return request ?? Promise.reject(new Error("The diff worker could not be started. Switch to File to view the source.")); }
}
function dispose() { reset(); cache.clear(); }
window.addEventListener("pagehide", dispose);
if (import.meta.hot) import.meta.hot.dispose(dispose);
