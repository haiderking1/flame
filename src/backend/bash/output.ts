// Keep a bounded UTF-8 tail while continuously draining both process pipes.
export class BashOutput {
  private tail = Buffer.alloc(0);
  private bytes = 0;
  constructor(private readonly limit = 64 * 1024) {}
  append(text: string) {
    const chunk = Buffer.from(text);
    this.bytes += chunk.length;
    const combined = chunk.length >= this.limit ? chunk : Buffer.concat([this.tail, chunk]);
    let start = Math.max(0, combined.length - this.limit);
    while (start < combined.length && (combined[start]! & 0xc0) === 0x80) start++;
    this.tail = Buffer.from(combined.subarray(start));
  }
  snapshot() {
    return { text: this.tail.toString("utf8"), bytes: this.bytes, truncated: this.bytes > this.tail.length };
  }
}
