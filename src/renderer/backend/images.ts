import { Effect } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Backend, backendRuntime } from "./client";
import type { SessionLocation } from "@contracts/sessions";
import { IMAGE_CHUNK_BYTES, type ImageInfo } from "@contracts/image-types";
import type { DraftImage } from "../components/images/draft-storage";

export const uploadImage = Atom.family((_key: string) => backendRuntime.fn((input: SessionLocation & { image: DraftImage; signal?: AbortSignal }) => Effect.gen(function* () {
  const client = yield* Backend, { image, signal, projectId, sessionId } = input;
  const location = { projectId, sessionId };
  yield* Effect.sync(() => signal?.throwIfAborted());
  const bytes = new Uint8Array(yield* Effect.promise(() => image.file.arrayBuffer()));
  const hash = new Uint8Array(yield* Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)));
  const sha256 = Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
  const target = { ...location, id: image.id };
  yield* Effect.sync(() => signal?.throwIfAborted());
  const existing = yield* client["images.begin"]({ ...target, name: image.name, bytes: bytes.length, sha256 });
  if (existing) return existing;
  for (let offset = 0; offset < bytes.length; offset += IMAGE_CHUNK_BYTES) {
    yield* Effect.sync(() => signal?.throwIfAborted());
    const data = btoa(String.fromCharCode(...bytes.subarray(offset, offset + IMAGE_CHUNK_BYTES)));
    yield* client["images.chunk"]({ ...target, offset, data });
  }
  yield* Effect.sync(() => signal?.throwIfAborted());
  return yield* client["images.finish"](target);
})));
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
