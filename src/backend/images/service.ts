import type { SessionLocation } from "../../contracts/sessions.js";
import type { ImageInfo } from "../../contracts/image-types.js";
import type { Sessions } from "../sessions/service.js";
import { imageError } from "./store.js";
import { normalizeImage } from "./normalize.js";
import { MAX_IMAGES } from "../../contracts/image-types.js";
import { readImageFile } from "./files.js";
import { receiveImage } from "./upload-body.js";
import { unlink } from "node:fs/promises";
import { SessionError } from "../../contracts/sessions.js";
import { ImageStaging, type StagedUpload } from "./staging.js";
export class Images {
  private active = new Map<string, { controller: AbortController; task: Promise<ImageInfo> }>();
  private closed = false;
  private warnedCleanup = false;
  constructor(readonly sessions: Sessions, private staging?: ImageStaging) {}
  private key(location: SessionLocation, id: string) { return `${location.projectId}:${location.sessionId}:${id}`; }
  private cleanupWarning() {
    if (this.warnedCleanup) return;
    this.warnedCleanup = true;
    this.sessions.warn("Some temporary image-upload files could not be removed. Ready images remain available; temporary files will be checked again during staging cleanup.");
  }
  finish(location: SessionLocation, id: string, signal: AbortSignal) {
    if (this.closed) throw imageError("Flame is shutting down.");
    const key = this.key(location, id), prior = this.active.get(key);
    if (prior) return prior.task;
    const saved = this.sessions.images(location, store => store.info(id));
    if (saved) return Promise.resolve(saved);
    if (this.active.size >= 3) throw imageError("Three images are already being uploaded or prepared. Retry when they finish.");
    const source = this.sessions.images(location, store => store.source(id)), controller = new AbortController();
    const task = normalizeImage(source.data, AbortSignal.any([signal, controller.signal])).then(prepared => {
      controller.signal.throwIfAborted(); signal.throwIfAborted();
      return this.sessions.images(location, store => store.finish(id, source, prepared));
    }).finally(() => this.active.delete(key));
    this.active.set(key, { controller, task }); return task;
  }
  upload(value: StagedUpload, body: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<ImageInfo> {
    if (this.closed) throw imageError("Flame is shutting down.");
    const staging = this.staging;
    if (!staging) throw imageError("Binary image uploads are unavailable.");
    staging.validate(value);
    const key = this.key(value, value.id);
    if (this.active.has(key)) throw imageError("This image is already uploading. Wait for it to finish before retrying.");
    if (this.active.size >= 3) throw imageError("Three images are already being uploaded or prepared. Retry when they finish.");
    const claimed = staging.claim(value), controller = new AbortController();
    const combined = AbortSignal.any([signal, controller.signal]);
    const task = (async () => {
      let temporary: string | undefined;
      try {
        combined.throwIfAborted();
        temporary = await receiveImage(claimed.root, value.id, value.bytes, value.sha256, body, combined);
        combined.throwIfAborted();
        if (claimed.ready) {
          const ready = staging.ready(value, value.id);
          if (!ready) throw imageError("The attachment was removed during its upload retry.");
          return ready;
        }
        const original = readImageFile(temporary, value.bytes, value.sha256);
        const prepared = await normalizeImage(original, combined);
        combined.throwIfAborted();
        return staging.complete(value, original, prepared);
      } catch (error) {
        if (!claimed.ready) { try { staging.resetPending(value, value.id); } catch { /* The original failure is authoritative; stale files expire safely. */ } }
        throw error;
      } finally {
        try { if (temporary) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.cleanupWarning(); }); }
        finally { this.active.delete(key); }
      }
    })();
    this.active.set(key, { controller, task }); return task;
  }
  staged(location: SessionLocation, ids: readonly string[]) {
    if (ids.length > MAX_IMAGES || new Set(ids).size !== ids.length) throw imageError("Verify at most 10 distinct image attachments.");
    return ids.flatMap(id => {
      const staged = this.staging?.ready(location, id);
      if (staged) return [staged];
      try { const saved = this.sessions.images(location, store => store.info(id)); return saved ? [saved] : []; }
      catch (error) { if (error instanceof SessionError && error.code === "NOT_FOUND") return []; throw error; }
    });
  }
  adopt(location: SessionLocation, ids: readonly string[]) {
    if (ids.length > MAX_IMAGES || new Set(ids).size !== ids.length) throw imageError("Attach at most 10 distinct images to one message.");
    const staged = ids.flatMap(id => {
      const image = this.staging?.artifacts(location, id);
      if (image) return [image];
      if (!this.sessions.images(location, store => store.info(id))) throw imageError("An attachment is no longer available. Retry attaching its original file.");
      return [];
    });
    this.sessions.images(location, store => store.adopt(staged));
    for (const id of ids) {
      try { this.staging?.discard(location, id); }
      catch {
        // Adoption already committed; redundant staging bytes must not turn a
        // ready attachment into an apparent failed send or invite reupload.
        this.cleanupWarning();
      }
    }
  }
  read(location: SessionLocation, id: string, offset: number, preview = false) {
    let saved: ReturnType<Images["readStored"]> = null;
    try { saved = this.readStored(location, id, offset, preview); }
    catch (error) { if (!(error instanceof SessionError && error.code === "NOT_FOUND")) throw error; }
    if (saved) return saved;
    const staged = this.staging?.read(location, id, offset, preview);
    if (!staged) throw imageError("Image unavailable. It may have been removed.");
    return staged;
  }
  private readStored(location: SessionLocation, id: string, offset: number, preview: boolean) {
    return this.sessions.images(location, store => store.info(id) ? store.read(id, offset, preview) : null);
  }
  discard(location: SessionLocation, id: string) {
    this.active.get(this.key(location, id))?.controller.abort();
    this.staging?.discard(location, id);
    try { this.sessions.images(location, store => store.discard(id)); }
    catch (error) { if (!(error instanceof SessionError && error.code === "NOT_FOUND")) throw error; }
  }
  async close() { this.closed = true; for (const item of this.active.values()) item.controller.abort(); await Promise.allSettled([...this.active.values()].map(item => item.task)); }
}
