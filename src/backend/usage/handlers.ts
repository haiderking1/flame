import { Effect, Queue, Stream } from "effect";
import { UsageError, UsageRpc, type UsageState } from "../../contracts/usage.js";
import type { CodexUsage } from "./service.js";

export function usageHandlers(usage: CodexUsage) {
  const operation = <A>(work: () => Promise<A>) => Effect.tryPromise({ try: work, catch: (error) =>
    error instanceof UsageError ? error : new UsageError({ message: "Codex usage could not be read or saved safely." }),
  }).pipe(Effect.uninterruptible);
  return UsageRpc.toLayer({
    "codex.usage.watch": () => Stream.callback<UsageState>((queue) => Effect.acquireRelease(
      Effect.sync(() => usage.watch(() => { Queue.offerUnsafe(queue, usage.state); })),
      (stop) => Effect.sync(stop),
    ), { bufferSize: 1, strategy: "sliding" }),
    "codex.usage.refresh": () => operation(() => usage.refresh(true)),
    "codex.reset.prepare": () => operation(() => usage.prepare()),
    "codex.reset.cancel": ({ id }) => Effect.sync(() => usage.cancel(id)),
    "codex.reset.confirm": ({ id }) => operation(() => usage.confirm(id)),
  });
}
