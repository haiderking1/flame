import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { Backend, backendRuntime } from "./client";
import type { SessionLocation } from "@contracts/sessions";

export const turnAtom = Atom.family((id: string) => backendRuntime.atom(id ? Stream.unwrap(Effect.map(Backend, (client) => {
  const [projectId, sessionId] = id.split(":") as [string, string];
  return client["turns.watch"]({ projectId, sessionId }).pipe(Stream.retry(Schedule.spaced("2 seconds")));
})) : Stream.succeed(null)));
export const startTurn = backendRuntime.fn((input: SessionLocation & { revision: number; requestId: string; text: string; accountKey: string; images?: readonly string[] }) =>
  Effect.flatMap(Backend, (client) => client["turns.start"](input)).pipe(Effect.timeout("20 seconds")));
export const stopTurn = backendRuntime.fn((input: SessionLocation & { turnId: string }) =>
  Effect.flatMap(Backend, (client) => client["turns.stop"](input)).pipe(Effect.timeout("10 seconds")));
export const compactTurn = backendRuntime.fn((input: SessionLocation & { revision: number; requestId: string; accountKey: string }) =>
  Effect.flatMap(Backend, (client) => client["turns.compact"](input)).pipe(Effect.timeout("20 seconds")));
