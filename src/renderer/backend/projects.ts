import { Cause, Effect, Option, Schedule, Stream } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { ProjectError } from "@contracts/projects";
import { Backend, backendRuntime } from "./client";

export const projectsAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, (client) =>
  client["projects.watch"]().pipe(Stream.retry(Schedule.spaced("1 second"))),
)));
export const browseAtom = Atom.family((path: string) => backendRuntime.atom(Effect.flatMap(Backend, (client) =>
  client["filesystem.browse"]({ path }).pipe(Effect.timeout("10 seconds")),
)));
export const addProjectAtom = backendRuntime.fn((path: string) => Effect.flatMap(Backend, (client) =>
  client["projects.add"]({ path }).pipe(Effect.timeout("10 seconds")),
));
export function resultMessage<A, E>(result: AsyncResult.AsyncResult<A, E>) {
  if (!AsyncResult.isFailure(result)) return null;
  const error = Cause.findErrorOption(result.cause);
  return Option.isSome(error) && error.value instanceof ProjectError ? error.value.message : "Could not reach the backend. Try again.";
}
