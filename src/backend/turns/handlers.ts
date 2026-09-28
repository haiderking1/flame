import { Cause, Effect, Queue, Stream } from "effect";
import { ModelsError } from "../../contracts/models.js";
import { SessionError } from "../../contracts/sessions.js";
import { TurnRpc, type TurnSnapshot } from "../../contracts/turns.js";
import { storageError } from "../sessions/files.js";
import type { Turns } from "./service.js";
const failure = (error: unknown) => error instanceof SessionError ? error : error instanceof ModelsError
  ? new SessionError({ code: "INVALID", message: error.message }) : storageError();
export function turnHandlers(turns: Turns) {
  return TurnRpc.toLayer({
    "turns.start": (input) => Effect.tryPromise({ try: () => turns.start(input), catch: failure }).pipe(Effect.uninterruptible),
    "turns.stop": (input) => Effect.try({ try: () => turns.stop(input, input.turnId), catch: failure }),
    "turns.watch": (location) => Stream.callback<TurnSnapshot | null, SessionError>((queue) => Effect.acquireRelease(Effect.sync(() => {
      const id = `${location.projectId}:${location.sessionId}`;
      const publish = (changed = id) => {
        if (changed !== id) return;
        try { Queue.offerUnsafe(queue, turns.snapshot(location)); }
        catch (error) { Queue.failCauseUnsafe(queue, Cause.fail(failure(error))); }
      };
      turns.on("change", publish); publish();
      return () => turns.off("change", publish);
    }), (stop) => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
  });
}
