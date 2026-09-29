import { Effect } from "effect";
import { ImageRpc } from "../../contracts/images.js";
import { SessionError } from "../../contracts/sessions.js";
import { ImagePreparationError } from "./normalize.js";
import type { Images } from "./service.js";
const failure = (error: unknown) => error instanceof SessionError ? error : error instanceof ImagePreparationError ? new SessionError({ code: "INVALID", message: error.message }) : new SessionError({ code: "STORAGE", message: "Could not prepare or access the image. It may be damaged or storage may be unavailable. Your message was not sent by this operation." });
export function imageHandlers(images: Images) {
  const sync = <T>(work: () => T) => Effect.try({ try: work, catch: failure }).pipe(Effect.uninterruptible);
  return ImageRpc.toLayer({
    "images.begin": input => sync(() => images.sessions.images(input, store => store.begin(input.id, input.name, input.bytes, input.sha256))),
    "images.chunk": input => sync(() => images.sessions.images(input, store => store.chunk(input.id, input.offset, input.data))),
    "images.finish": input => Effect.tryPromise({ try: signal => images.finish(input, input.id, signal), catch: failure }),
    "images.read": input => sync(() => images.sessions.images(input, store => store.read(input.id, input.offset, input.preview))),
    "images.discard": input => sync(() => images.discard(input, input.id)),
  });
}
