import type { SessionLocation } from "../../contracts/sessions.js";
import type { ImageInfo } from "../../contracts/image-types.js";
import type { Sessions } from "../sessions/service.js";
import { imageError } from "./store.js";
import { normalizeImage } from "./normalize.js";
export class Images {
  private active = new Map<string, { controller: AbortController; task: Promise<ImageInfo> }>();
  private closed = false;
  constructor(readonly sessions: Sessions) {}
  private key(location: SessionLocation, id: string) { return `${location.projectId}:${location.sessionId}:${id}`; }
  finish(location: SessionLocation, id: string, signal: AbortSignal) {
    if (this.closed) throw imageError("Flame is shutting down.");
    const key = this.key(location, id), prior = this.active.get(key);
    if (prior) return prior.task;
    const saved = this.sessions.images(location, store => store.info(id));
    if (saved) return Promise.resolve(saved);
    if (this.active.size >= 2) throw imageError("Two images are already being prepared. Retry when they finish.");
    const source = this.sessions.images(location, store => store.source(id)), controller = new AbortController();
    const task = normalizeImage(source.data, AbortSignal.any([signal, controller.signal])).then(prepared => {
      controller.signal.throwIfAborted(); signal.throwIfAborted();
      return this.sessions.images(location, store => store.finish(id, source, prepared));
    }).finally(() => this.active.delete(key));
    this.active.set(key, { controller, task }); return task;
  }
  discard(location: SessionLocation, id: string) {
    this.active.get(this.key(location, id))?.controller.abort();
    this.sessions.images(location, store => store.discard(id));
  }
  async close() { this.closed = true; for (const item of this.active.values()) item.controller.abort(); await Promise.allSettled([...this.active.values()].map(item => item.task)); }
}
