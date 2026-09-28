import { Effect, Queue, Stream } from "effect";
import { ModelsError } from "../../contracts/models.js";
import { SessionError, SessionRpc, type SessionIndex } from "../../contracts/sessions.js";
import { storageError } from "./files.js";
import type { Sessions } from "./service.js";

export function sessionHandlers(sessions: Sessions) {
  const work = <A>(run: () => A) => Effect.try({ try: run, catch: (error) => error instanceof SessionError ? error
    : error instanceof ModelsError ? new SessionError({ code: "INVALID", message: error.message }) : storageError() }).pipe(Effect.uninterruptible);
  return SessionRpc.toLayer({
    "sessions.watch": () => Stream.callback<typeof SessionIndex.Type>((queue) => Effect.acquireRelease(Effect.sync(() => {
      const publish = () => { Queue.offerUnsafe(queue, sessions.snapshot()); };
      sessions.on("change", publish); publish();
      return () => { sessions.removeListener("change", publish); };
    }), (stop) => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
    "sessions.create": (location) => work(() => sessions.create(location)),
    "sessions.read": (location) => work(() => sessions.read(location)),
    "sessions.history": (input) => work(() => sessions.history(input, input.before)),
    "sessions.draft": (input) => work(() => sessions.draft(input, input.revision, input.draft)),
    "sessions.rename": (input) => work(() => sessions.rename(input, input.revision, input.title)),
    "sessions.append": (input) => work(() => sessions.append(input, input.revision, input.requestId, input.text)),
    "sessions.configure": (input) => work(() => sessions.configure(input, input.revision, input.accountKey,
      { modelId: input.modelId, effort: input.effort, serviceTier: input.serviceTier })),
    "sessions.delete": (input) => work(() => sessions.remove(input, input.revision)),
  });
}
