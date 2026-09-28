import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Backend, backendRuntime } from "./client";
import type { SessionLocation } from "@contracts/sessions";
export const bashJobsAtom = Atom.family((id: string) => backendRuntime.atom(Stream.unwrap(Effect.map(Backend, client => {
  const [projectId, sessionId] = id.split(":") as [string, string];
  return client["bash.watch"]({ projectId, sessionId }).pipe(Stream.retry(Schedule.spaced("2 seconds")));
}))));
export const readBash = backendRuntime.fn((input: SessionLocation & { jobId: string }) =>
  Effect.flatMap(Backend, client => client["bash.read"](input)).pipe(Effect.timeout("10 seconds")));
export const stopBash = backendRuntime.fn((input: SessionLocation & { jobId: string }) =>
  Effect.flatMap(Backend, client => client["bash.stop"](input)).pipe(Effect.timeout("10 seconds")));
