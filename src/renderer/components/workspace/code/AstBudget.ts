import { retainedBytes } from "./cacheBudget.ts";
export interface AstCache {
  readonly size: number;
  forEach(visitor: (value: object, key: string) => void): void;
  entries(): Iterator<[string, object]>;
  delete(key: string): unknown;
}
/** Enforces one shared byte budget across the file and diff result LRUs. */
export class AstBudget {
  private readonly estimates = new WeakMap<object, number>();
  readonly maxBytes: number;
  constructor(maxBytes: number) { if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid AST budget"); this.maxBytes = maxBytes; }
  private bytes(value: object, key: string) {
    let bytes = this.estimates.get(value);
    if (bytes === undefined) { bytes = retainedBytes(value, this.maxBytes); this.estimates.set(value, bytes); }
    return bytes + 32 + key.length * 2;
  }
  trim(caches: readonly AstCache[]) {
    let total = 0;
    for (const cache of caches) cache.forEach((value, key) => { total += this.bytes(value, key); });
    for (const cache of caches) while (total > this.maxBytes && cache.size) {
      const oldest = cache.entries().next().value!;
      total -= this.bytes(oldest[1], oldest[0]); cache.delete(oldest[0]);
    }
    return { bytes: total, entries: caches.reduce((count, cache) => count + cache.size, 0) };
  }
}
