import { Cause, Effect, Queue, Schema, Stream } from "effect";
import { BashRpc, BashJob } from "../../contracts/bash.js";
import { SessionError } from "../../contracts/sessions.js";
import { storageError } from "../sessions/files.js";
import type { BashRuntime } from "./service.js";
const failure = (error: unknown) => error instanceof SessionError ? error : storageError();
export function bashHandlers(bash: BashRuntime) {
  return BashRpc.toLayer({
    "bash.read": input => Effect.try({ try: () => {
      const job = bash.get(input, input.jobId);
      if (!job) throw new SessionError({ code: "NOT_FOUND", message: "This command record is no longer available." });
      return Schema.decodeUnknownSync(BashJob)(job);
    }, catch: failure }),
    "bash.stop": input => Effect.try({ try: () => bash.stop(input, input.jobId), catch: failure }),
    "bash.watch": location => Stream.callback<readonly BashJob[], SessionError>(queue => Effect.acquireRelease(Effect.sync(() => {
      const id = `${location.projectId}:${location.sessionId}`;
      const publish = (changed = id) => {
        if (changed !== id) return;
        try { Queue.offerUnsafe(queue, bash.list(location)); }
        catch (error) { Queue.failCauseUnsafe(queue, Cause.fail(failure(error))); }
      };
      bash.on("change", publish); publish();
      return () => bash.off("change", publish);
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
  });
}
