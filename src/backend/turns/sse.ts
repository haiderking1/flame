export class InferenceFailure extends Error {}

// Incremental UTF-8 decoding and SSE framing, including CRLF split across reads.
export async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", data: string[] = [], bytes = 0, eventSize = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const idle = setTimeout(abort, 90_000);
      let chunk;
      try { chunk = await reader.read(); } finally { clearTimeout(idle); }
      signal.throwIfAborted();
      bytes += chunk.value?.byteLength ?? 0;
      if (bytes > 24 * 1024 * 1024) throw new InferenceFailure("The provider response exceeded the transport limit.");
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      // Codex may omit the final blank line. Flush that frame, but still require
      // an explicit success event: EOF or a text delta alone is not completion.
      if (chunk.done && (buffer.length || data.length)) buffer += "\n\n";
      if (buffer.length > 8 * 1024 * 1024) throw new InferenceFailure("The provider returned an oversized event.");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, ""); buffer = buffer.slice(index + 1);
        if (!line) {
          if (data.length) yield data.join("\n");
          data = []; eventSize = 0;
        } else if (line.startsWith("data:")) {
          const value = line.slice(5).replace(/^ /, ""); eventSize += value.length;
          if (eventSize > 8 * 1024 * 1024) throw new InferenceFailure("The provider returned an oversized event.");
          data.push(value);
        }
      }
      if (chunk.done) break;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
