import { InferenceFailure } from "./sse.js";

export class ContextOverflow extends InferenceFailure {}
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function isContextOverflow(value: unknown): boolean {
  const error = record(value);
  return ["context_length_exceeded", "context_window_exceeded", "max_context_length_exceeded"].includes(String(error.code))
    || ["context_length_exceeded", "context_window_exceeded"].includes(String(error.type));
}
export function providerFailure(value: unknown): InferenceFailure {
  return isContextOverflow(value) ? new ContextOverflow("OpenAI's context window is full.")
    : new InferenceFailure("OpenAI did not complete this response. The request was not replayed.");
}
export async function readProviderError(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 16 * 1024) return undefined;
      chunks.push(chunk.value);
    }
    return record(JSON.parse(Buffer.concat(chunks).toString("utf8"))).error;
  } catch { return undefined; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
