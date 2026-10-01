/** An LRU with conservative retained-byte accounting and independent count limits. */
export class ByteLru<K, V> {
  private readonly entries = new Map<K, { value: V; bytes: number }>();
  private retained = 0;
  readonly maxEntries: number;
  readonly maxBytes: number;
  constructor(maxEntries: number, maxBytes: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("Invalid cache budget");
    this.maxEntries = maxEntries; this.maxBytes = maxBytes;
  }
  get size() { return this.entries.size; }
  get bytes() { return this.retained; }
  get(key: K): V | undefined {
    const item = this.entries.get(key);
    if (!item) return undefined;
    this.entries.delete(key); this.entries.set(key, item);
    return item.value;
  }
  set(key: K, value: V, bytes: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError("Invalid cache entry size");
    this.delete(key);
    if (!this.maxEntries || bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes }); this.retained += bytes;
    while (this.size > this.maxEntries || this.retained > this.maxBytes) this.delete(this.entries.keys().next().value!);
  }
  delete(key: K) {
    const item = this.entries.get(key);
    if (item) { this.retained -= item.bytes; this.entries.delete(key); }
  }
  clear() { this.entries.clear(); this.retained = 0; }
}
