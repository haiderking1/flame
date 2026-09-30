import { Schema } from "effect";
import { ImageInfo } from "@contracts/image-types";
import type { SessionLocation } from "@contracts/sessions";
import type { DraftImage } from "../components/images/draft-storage";
import type { UploadStatus } from "../components/images/upload-queue";

const hashes = new WeakMap<Blob, Promise<string>>();
export function imageDigest(file: Blob): Promise<string> {
  let digest = hashes.get(file);
  if (!digest) {
    digest = file.arrayBuffer().then(bytes => crypto.subtle.digest("SHA-256", bytes)).then(value =>
      Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, "0")).join(""));
    hashes.set(file, digest);
    void digest.catch(() => hashes.delete(file));
  }
  return digest;
}
export async function uploadImageBinary(location: SessionLocation, image: DraftImage, signal: AbortSignal,
  progress: (status: UploadStatus, percentage: number) => void): Promise<ImageInfo> {
  signal.throwIfAborted(); progress("hashing", 0);
  const sha256 = await imageDigest(image.file);
  signal.throwIfAborted();
  const url = new URL(await window.flame.connection());
  if (!['ws:', 'wss:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.searchParams.get('token')) throw new Error("Image upload connection is unavailable.");
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'; url.pathname = '/images/upload';
  for (const [name, value] of Object.entries({ ...location, id: image.id, name: image.name, bytes: String(image.file.size), sha256 })) url.searchParams.set(name, value);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => signal.removeEventListener("abort", abort);
    request.open("POST", url); request.timeout = 120_000;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = event => progress("uploading", event.lengthComputable ? Math.round(event.loaded / event.total * 100) : 0);
    request.upload.onload = () => progress("preparing", 100);
    request.onerror = () => { cleanup(); reject(new Error("Could not upload this image. Check your connection and retry.")); };
    request.ontimeout = () => { cleanup(); reject(new Error("Image preparation timed out. Retry this upload.")); };
    request.onabort = () => { cleanup(); reject(signal.reason ?? new DOMException("Image upload cancelled", "AbortError")); };
    request.onload = () => {
      cleanup();
      try {
        signal.throwIfAborted();
        let response: unknown;
        try { response = JSON.parse(request.responseText); }
        catch {
          throw new Error(`Image upload failed (HTTP ${request.status}). Retry this image.`);
        }
        if (request.status < 200 || request.status >= 300) {
          const message = response && typeof response === "object" && "message" in response && typeof response.message === "string" ? response.message : `Image upload failed (HTTP ${request.status}). Retry this image.`;
          throw new Error(message);
        }
        const info = Schema.decodeUnknownSync(ImageInfo)(response);
        if (info.id !== image.id || info.name !== image.name || info.bytes !== image.file.size || info.sha256 !== sha256) throw new Error("The image upload confirmation did not match the original file. Retry this image.");
        resolve(info);
      } catch (error) { reject(error); }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { cleanup(); reject(signal.reason); return; }
    progress("uploading", 0); request.send(image.file);
  });
}
