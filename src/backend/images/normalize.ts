import { Worker } from "node:worker_threads";
import { probeImage } from "./probe.js";
import { MAX_IMAGE_BYTES } from "../../contracts/image-types.js";
export class ImagePreparationError extends Error {}
export type PreparedImage = { data: Uint8Array; mimeType: string; originalMime: string; width: number; height: number; modelWidth: number; modelHeight: number };
export function normalizeImage(bytes: Uint8Array, signal: AbortSignal): Promise<PreparedImage> {
  signal.throwIfAborted();
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new ImagePreparationError("Images must be between 1 byte and 20 MiB.");
  try { probeImage(bytes); } catch (error) { throw new ImagePreparationError(error instanceof Error ? error.message : "Invalid image header."); }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./normalize.worker.js", import.meta.url), { workerData: bytes });
    let settled = false;
    const finish = (error?: Error, result?: PreparedImage) => {
      if (settled) return; settled = true;
      signal.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new ImagePreparationError("Image preparation stopped. Your attachment was not sent."));
    signal.addEventListener("abort", abort, { once: true });
    worker.once("message", result => result.error ? finish(new ImagePreparationError(String(result.error).slice(0, 256))) : finish(undefined, result));
    worker.once("error", () => finish(new ImagePreparationError("Image preparation failed. The image may be damaged or too large to decode.")));
    worker.once("exit", () => { if (!settled) finish(new ImagePreparationError("Image preparation ended without a result.")); });
    if (signal.aborted) abort();
  });
}
