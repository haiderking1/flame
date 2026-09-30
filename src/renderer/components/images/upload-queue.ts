import type { SessionLocation } from "@contracts/sessions";
import type { ImageInfo } from "@contracts/image-types";
import type { DraftImage } from "./draft-storage";

export type UploadStatus = "checking" | "queued" | "hashing" | "uploading" | "preparing" | "ready" | "failed";
export type ImageUploadState = { status: UploadStatus; progress: number; error: string | null; info?: ImageInfo };
export type UploadTransport = (location: SessionLocation, image: DraftImage, signal: AbortSignal, progress: (status: UploadStatus, percentage: number) => void) => Promise<ImageInfo>;
type Job = { location: SessionLocation; image: DraftImage; state: ImageUploadState; controller: AbortController; promise: Promise<ImageInfo>; resolve(info: ImageInfo): void; reject(error: unknown): void };
const key = (location: SessionLocation, id: string) => `${location.projectId}:${location.sessionId}:${id}`;
const scopeKey = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
const cancelled = () => new DOMException("Image upload cancelled", "AbortError");

export class ImageUploadQueue {
  private jobs = new Map<string, Job>();
  private removed = new Set<string>();
  private owners = new Map<string, number>();
  private managed = new Set<string>();
  private closed = new Set<string>();
  private listeners = new Set<() => void>();
  private active = 0;
  private snapshot: ReadonlyMap<string, ImageUploadState> = new Map();
  private transport: UploadTransport;
  private concurrency: number;
  private digest: (file: Blob) => Promise<string>;
  constructor(transport: UploadTransport, concurrency = 3, digest: (file: Blob) => Promise<string> = async file => {
    const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
  }) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError("Upload concurrency must be positive.");
    this.transport = transport; this.concurrency = concurrency; this.digest = digest;
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  state(location: SessionLocation, id: string) { return this.snapshot.get(key(location, id)); }
  retain(location: SessionLocation) {
    const scope = scopeKey(location); this.managed.add(scope); this.owners.set(scope, (this.owners.get(scope) ?? 0) + 1);
    return () => { this.owners.set(scope, Math.max(0, (this.owners.get(scope) ?? 1) - 1)); this.releaseSettled(location); };
  }
  private releaseSettled(location: SessionLocation) {
    const scope = scopeKey(location);
    if (this.owners.get(scope)) return;
    for (const [id, job] of this.jobs) if (scopeKey(job.location) === scope && (job.state.status === "ready" || job.state.status === "failed")) this.jobs.delete(id);
    this.publish();
  }
  private settled(job: Job) {
    if (this.managed.has(scopeKey(job.location))) this.releaseSettled(job.location);
    const unowned = [...this.jobs].filter(([, own]) => !this.owners.get(scopeKey(own.location)) && (own.state.status === "ready" || own.state.status === "failed"));
    for (const [id] of unowned.slice(0, Math.max(0, unowned.length - 20))) this.jobs.delete(id);
    this.publish();
  }
  private publish() { this.snapshot = new Map([...this.jobs].map(([id, job]) => [id, job.state])); for (const listener of this.listeners) listener(); }
  private create(location: SessionLocation, image: DraftImage, status: UploadStatus): Job {
    let resolve!: Job["resolve"], reject!: Job["reject"];
    const promise = new Promise<ImageInfo>((yes, no) => { resolve = yes; reject = no; });
    void promise.catch(() => {});
    const job = { location: { ...location }, image, state: { status, progress: 0, error: null }, controller: new AbortController(), promise, resolve, reject };
    this.jobs.set(key(location, image.id), job); return job;
  }
  private current(job: Job) { return this.jobs.get(key(job.location, job.image.id)) === job && !job.controller.signal.aborted; }
  private update(job: Job, state: ImageUploadState) { if (this.current(job)) { job.state = state; this.publish(); } }
  private pump() {
    for (const job of this.jobs.values()) {
      if (this.active >= this.concurrency) break;
      if (job.state.status !== "queued") continue;
      this.active++;
      this.update(job, { status: "hashing", progress: 0, error: null });
      void Promise.resolve().then(() => this.transport(job.location, job.image, job.controller.signal, (status, progress) => {
        this.update(job, { status, progress: Math.max(0, Math.min(100, progress)), error: null });
      })).then(info => {
        if (!this.current(job)) return;
        this.update(job, { status: "ready", progress: 100, error: null, info }); job.resolve(info); this.settled(job);
      }, error => {
        if (!this.current(job)) return;
        this.update(job, { status: "failed", progress: 0, error: error instanceof Error ? error.message : "Image upload failed. Try again." }); job.reject(error); this.settled(job);
      }).finally(() => { this.active--; this.pump(); });
    }
  }
  private async assertDescriptor(location: SessionLocation, image: DraftImage) {
    const previous = this.jobs.get(key(location, image.id));
    if (!previous) return;
    if (previous.image.name !== image.name || previous.image.file.size !== image.file.size || previous.image.file.type !== image.file.type
      || previous.image.file !== image.file && await this.digest(previous.image.file) !== await this.digest(image.file)) {
      throw new Error("This image identifier belongs to a different original file. Remove the attachment and attach it again.");
    }
  }
  async enqueue(location: SessionLocation, images: readonly DraftImage[]) {
    if (this.closed.has(scopeKey(location))) throw cancelled();
    await Promise.all(images.map(image => this.assertDescriptor(location, image)));
    for (const image of images) if (!this.removed.has(key(location, image.id)) && !this.jobs.has(key(location, image.id))) this.create(location, image, "queued");
    this.publish(); this.pump();
  }
  async restore(location: SessionLocation, images: readonly DraftImage[], lookup: (ids: readonly string[]) => Promise<readonly ImageInfo[]>) {
    if (this.closed.has(scopeKey(location))) throw cancelled();
    await Promise.all(images.map(image => this.assertDescriptor(location, image)));
    const fresh = images.filter(image => !this.removed.has(key(location, image.id)) && !this.jobs.has(key(location, image.id))).map(image => this.create(location, image, "checking"));
    if (!fresh.length) return;
    this.publish();
    try {
      const ready = new Map((await lookup(fresh.map(job => job.image.id))).map(info => [info.id, info]));
      for (const job of fresh) {
        if (!this.current(job)) continue;
        const info = ready.get(job.image.id);
        if (info) { this.update(job, { status: "ready", progress: 100, error: null, info }); job.resolve(info); this.settled(job); }
        else this.update(job, { status: "queued", progress: 0, error: null });
      }
      this.pump();
    } catch (error) {
      for (const job of fresh) if (this.current(job)) {
        this.update(job, { status: "failed", progress: 0, error: "Could not check this image upload. Retry to reconnect." }); job.reject(error); this.settled(job);
      }
    }
  }
  retry(location: SessionLocation, image: DraftImage) {
    if (this.closed.has(scopeKey(location))) return;
    if (this.removed.has(key(location, image.id))) return;
    const old = this.jobs.get(key(location, image.id));
    if (old && old.state.status !== "failed") return;
    this.create(location, image, "queued"); this.publish(); this.pump();
  }
  async ready(location: SessionLocation, images: readonly DraftImage[], signal?: AbortSignal): Promise<readonly ImageInfo[]> {
    const release = this.retain(location);
    try { return await this.awaitReady(location, images, signal); } finally { release(); }
  }
  private async awaitReady(location: SessionLocation, images: readonly DraftImage[], signal?: AbortSignal): Promise<readonly ImageInfo[]> {
    signal?.throwIfAborted();
    await this.enqueue(location, images);
    signal?.throwIfAborted();
    for (const image of images) if (this.state(location, image.id)?.status === "failed") this.retry(location, image);
    const result = Promise.all(images.map(image => this.jobs.get(key(location, image.id))?.promise ?? Promise.reject(cancelled())));
    if (!signal) return result;
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason ?? cancelled()); };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      result.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    });
  }
  async remove(location: SessionLocation, id: string, discard: () => Promise<void>) {
    this.removed.add(key(location, id));
    const job = this.jobs.get(key(location, id));
    if (job) { this.jobs.delete(key(location, id)); job.controller.abort(); job.reject(cancelled()); this.publish(); }
    // Discard is idempotent. A response already committed before abort is still
    // removed, while cancelled streaming requests cannot recreate this ID.
    await discard();
  }
  forget(location: SessionLocation, ids: readonly string[]) {
    for (const id of ids) {
      this.removed.add(key(location, id));
      const job = this.jobs.get(key(location, id));
      if (job) { this.jobs.delete(key(location, id)); job.controller.abort(); job.reject(cancelled()); }
    }
    this.publish();
  }
  invalidate(location: SessionLocation, ids: readonly string[], message: string) {
    for (const id of ids) {
      const old = this.jobs.get(key(location, id));
      if (!old || old.state.status !== "ready") continue;
      const job = this.create(location, old.image, "failed");
      job.state = { status: "failed", progress: 0, error: message }; job.reject(new Error(message));
    }
    this.publish();
  }
  clearScope(location: SessionLocation) {
    this.closed.add(scopeKey(location));
    for (const [id, job] of this.jobs) if (scopeKey(job.location) === scopeKey(location)) {
      this.jobs.delete(id); job.controller.abort(); job.reject(cancelled());
    }
    this.publish();
  }
}
