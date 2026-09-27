import { Cause, Effect, Option, Schedule, Stream } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { AuthError } from "@contracts/auth";
import { Backend, backendRuntime } from "./client";

export const codexAuthAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, (client) =>
  client["codex.auth.watch"]().pipe(Stream.retry(Schedule.spaced("1 second"))),
))).pipe(Atom.keepAlive);
export const codexAuthAction = backendRuntime.fn((action: "login" | "cancel" | "logout") =>
  Effect.flatMap(Backend, (client) => client[`codex.auth.${action}`]().pipe(Effect.timeout("15 seconds"))),
);
export function authActionMessage(result: AsyncResult.AsyncResult<unknown, unknown>) {
  if (!AsyncResult.isFailure(result)) return null;
  const error = Cause.findErrorOption(result.cause);
  return Option.isSome(error) && error.value instanceof AuthError ? error.value.message : "Could not reach the backend. Try again.";
}
