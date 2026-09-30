import { Effect, Stream } from "effect";
import { HttpServerResponse, type HttpServerRequest } from "effect/unstable/http";
import { SessionError } from "../../contracts/sessions.js";
import { ImagePreparationError } from "./normalize.js";
import { imageError } from "./store.js";
import type { Images } from "./service.js";
import type { StagedUpload } from "./staging.js";

export function parseImageUpload(url: string, headers: Readonly<Record<string, string | undefined>>): StagedUpload {
  const parsed = new URL(url, "http://127.0.0.1");
  if (parsed.pathname !== "/images/upload") throw imageError("Invalid image upload endpoint.");
  for (const field of ["projectId", "sessionId", "id", "name", "bytes", "sha256"]) {
    if (parsed.searchParams.getAll(field).length !== 1) throw imageError("Invalid image upload metadata.");
  }
  const declared = parsed.searchParams.get("bytes")!;
  if (!/^\d+$/.test(declared)) throw imageError("Invalid image upload size.");
  const bytes = Number(declared), length = headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) !== bytes)) throw imageError("Image upload size does not match Content-Length.");
  if (headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/octet-stream") throw imageError("Upload images as a binary request body.");
  return { projectId: parsed.searchParams.get("projectId")!, sessionId: parsed.searchParams.get("sessionId")!, id: parsed.searchParams.get("id")!,
    name: parsed.searchParams.get("name")!, bytes, sha256: parsed.searchParams.get("sha256")! };
}

// The server authenticates token, loopback Host and Origin before calling this
// adapter. Request streaming remains tied to the Effect cancellation signal.
export function imageUploadHttp(images: Images, request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    if (request.method !== "POST") return HttpServerResponse.empty({ status: 405, headers: { allow: "POST, OPTIONS" } });
    const value = yield* Effect.try({ try: () => parseImageUpload(request.url, request.headers), catch: error => error });
    const body = yield* Stream.toAsyncIterableEffect(request.stream);
    const info = yield* Effect.tryPromise({
      try: signal => images.upload(value, body, AbortSignal.any([signal, AbortSignal.timeout(2 * 60_000)])),
      catch: error => error,
    });
    return yield* HttpServerResponse.json(info);
  }).pipe(Effect.catch(error => {
    const status = error instanceof SessionError ? error.code === "NOT_FOUND" ? 404 : error.code === "STORAGE" ? 500 : 400
      : error instanceof ImagePreparationError ? 400 : 500;
    const message = error instanceof SessionError || error instanceof ImagePreparationError ? error.message
      : "Could not upload the image. Retry attaching the original file.";
    return HttpServerResponse.json({ message }, { status });
  }));
}
