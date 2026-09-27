import { Cause, Effect, Option, Schedule, Stream } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { UsageError } from "@contracts/usage";
import { Backend, backendRuntime } from "./client";

export const usageAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, (client) =>
  client["codex.usage.watch"]().pipe(Stream.retry(Schedule.spaced("3 seconds"))),
)));
export const refreshUsage = backendRuntime.fn(() => Effect.flatMap(Backend, (client) => client["codex.usage.refresh"]()));
export const prepareReset = backendRuntime.fn(() => Effect.flatMap(Backend, (client) => client["codex.reset.prepare"]()));
export const cancelReset = backendRuntime.fn((id: string) => Effect.flatMap(Backend, (client) => client["codex.reset.cancel"]({ id })));
export const confirmReset = backendRuntime.fn((id: string) => Effect.flatMap(Backend, (client) => client["codex.reset.confirm"]({ id })));
export function usageErrorMessage(result: AsyncResult.AsyncResult<unknown, unknown>) {
  if (!AsyncResult.isFailure(result)) return null;
  const error = Cause.findErrorOption(result.cause);
  return Option.isSome(error) && error.value instanceof UsageError ? error.value.message : "Could not reach the backend. No reset will be retried automatically.";
}
