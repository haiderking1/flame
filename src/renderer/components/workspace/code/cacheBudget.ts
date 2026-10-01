export const AST_CACHE_BYTES = 16 * 1024 * 1024;
export const CODE_TOKENIZE_LINE = 1000;
/** Conservative object-graph accounting; oversized graphs stop traversal early. */
export function retainedBytes(value: unknown, limit = AST_CACHE_BYTES): number {
  const seen = new Set<object>(), stack: unknown[] = [value];
  let bytes = 0;
  while (stack.length && bytes <= limit) {
    const item = stack.pop();
    if (typeof item === "string") bytes += 24 + item.length * 2;
    else if (item && typeof item === "object" && !seen.has(item)) {
      seen.add(item); bytes += 96;
      for (const key in item) if (Object.hasOwn(item, key)) {
        bytes += 16 + key.length * 2; stack.push((item as Record<string, unknown>)[key]);
        if (stack.length > 50_000 || bytes > limit) return limit + 1;
      }
    } else bytes += 8;
    if (seen.size > 50_000) return limit + 1;
  }
  return bytes;
}
export function codePoolSize(cores: number, memoryGiB = 2) {
  return Math.max(1, Math.min(memoryGiB < 4 ? 1 : 2, Math.floor(Math.max(1, cores || 1) / 2)));
}
