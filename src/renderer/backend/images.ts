import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Backend, backendRuntime } from "./client";
import type { SessionLocation } from "@contracts/sessions";
import { type ImageInfo } from "@contracts/image-types";

export { uploadImageBinary, imageDigest } from "./image-upload";
export const stagedImages = Atom.family((_key: string) => backendRuntime.fn((input: SessionLocation & { ids: readonly string[] }) =>
  Effect.flatMap(Backend, client => client["images.staged"](input)).pipe(Effect.timeout("15 seconds")), { concurrent: true }));
export const adoptImages = Atom.family((_key: string) => backendRuntime.fn((input: SessionLocation & { ids: readonly string[] }) =>
  Effect.flatMap(Backend, client => client["images.adopt"](input)).pipe(Effect.timeout("30 seconds")), { concurrent: true }));
export const downloadImage = Atom.family((_key: string) => backendRuntime.fn((input: SessionLocation & { image: ImageInfo; preview?: boolean }) => Effect.gen(function* () {
  const client = yield* Backend, chunks: Uint8Array<ArrayBuffer>[] = [];
  const expected = input.preview ? input.image.modelBytes : input.image.bytes;
  let offset: number | null = 0, size = 0;
  do {
    const result: { readonly data: string; readonly next: number | null } = yield* client["images.read"]({ ...input, id: input.image.id, offset });
    const chunk = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
    size += chunk.length;
    if (size > expected || result.next !== null && result.next !== size) return yield* Effect.fail(new Error("Image transfer was incomplete."));
    chunks.push(chunk); offset = result.next;
  } while (offset !== null);
  if (size !== expected) return yield* Effect.fail(new Error("Image transfer was incomplete."));
  const blob = new Blob(chunks, { type: input.preview ? input.image.modelMimeType : input.image.mimeType });
  const digest = new Uint8Array(yield* Effect.promise(async () => crypto.subtle.digest("SHA-256", await blob.arrayBuffer())));
  const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== (input.preview ? input.image.modelSha256 : input.image.sha256)) return yield* Effect.fail(new Error("The stored image changed. It was not displayed."));
  return blob;
})));
export const discardImage = Atom.family((_key: string) => backendRuntime.fn((input: SessionLocation & { id: string }) => Effect.flatMap(Backend, client => client["images.discard"](input))));
