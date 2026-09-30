import { ImagePreparationError } from "./preparation-error.js";

type Waiter = { enter: () => void; cancel: () => void };
// Uploads and tool reads share the same worker bound. Waiting consumes no decoder memory.
class PreparationQueue {
  private active = 0;
  private waiting: Waiter[] = [];
  async run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= 2) {
      if (this.waiting.length >= 16) throw new ImagePreparationError("Too many images are waiting for preparation. Retry when they finish.");
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          enter: () => { signal.removeEventListener("abort", waiter.cancel); this.active++; resolve(); },
          cancel: () => { signal.removeEventListener("abort", waiter.cancel); this.waiting = this.waiting.filter(item => item !== waiter); reject(signal.reason); },
        };
        this.waiting.push(waiter); signal.addEventListener("abort", waiter.cancel, { once: true });
        if (signal.aborted) waiter.cancel();
      });
    } else this.active++;
    try { signal.throwIfAborted(); return await work(); }
    finally { this.active--; this.waiting.shift()?.enter(); }
  }
}
export const preparationQueue = new PreparationQueue();
