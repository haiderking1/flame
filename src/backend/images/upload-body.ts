import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { MAX_IMAGE_BYTES } from "../../contracts/image-types.js";
import { imageError } from "./store.js";

async function nextChunk(iterator: AsyncIterator<Uint8Array>, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<IteratorResult<Uint8Array>>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => iterator.next()).then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

// One bounded binary transfer, written outside SQLite. A partial upload is
// never advertised as ready and is removed even when cancellation interrupts it.
export async function receiveImage(root: string, id: string, bytes: number, sha256: string,
  body: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<string> {
  const temporary = join(root, `.${id}.${randomUUID()}.upload`);
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let successful = false;
  const iterator = body[Symbol.asyncIterator]();
  try {
    const hash = createHash("sha256");
    let received = 0;
    for (;;) {
      const next = await nextChunk(iterator, signal);
      if (next.done) break;
      const chunk = next.value;
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw imageError("Invalid binary image upload.");
      received += chunk.byteLength;
      if (received > bytes || received > MAX_IMAGE_BYTES) throw imageError("Image upload exceeds its declared size.");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        signal.throwIfAborted();
        const written = await file.write(chunk, offset, chunk.byteLength - offset);
        if (!written.bytesWritten) throw new Error("Image upload could not be written.");
        offset += written.bytesWritten;
      }
    }
    signal.throwIfAborted();
    if (received !== bytes || hash.digest("hex") !== sha256) throw imageError("Image upload checksum or size did not match. Retry attaching the original file.");
    await file.sync(); signal.throwIfAborted();
    successful = true; return temporary;
  } finally {
    // A stalled peer cannot hold a slot open after cancellation. Do not await
    // a generator return that itself waits on that peer's pending read.
    if (!successful && iterator.return) void Promise.resolve().then(() => iterator.return!()).catch(() => {});
    await file.close();
    if (!successful) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  }
}
