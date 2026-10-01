import { Effect, Schedule, Stream } from "effect";
import { SessionError, type SessionLocation } from "@contracts/sessions";
import type { ModelSelection } from "@contracts/models";
import { Backend, backendRuntime } from "./client";

export const sessionsAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, (client) =>
  client["sessions.watch"]().pipe(Stream.retry(Schedule.spaced("2 seconds"))),
)));
export const readSession = backendRuntime.fn((location: SessionLocation) => Effect.flatMap(Backend, (client) => client["sessions.read"](location)).pipe(Effect.timeout("10 seconds")));
export const createSession = backendRuntime.fn((location: SessionLocation) => Effect.flatMap(Backend, (client) => client["sessions.create"](location)).pipe(Effect.timeout("10 seconds")));
export const sessionHistory = backendRuntime.fn((input: SessionLocation & { before: string | null }) => Effect.flatMap(Backend, (client) => client["sessions.history"](input)).pipe(Effect.timeout("10 seconds")));
export type SessionChange = SessionLocation & { revision: number } & (
  { type: "draft"; draft: string } | { type: "rename"; title: string } | { type: "settle"; settled: boolean } | { type: "append"; requestId: string; text: string; images?: readonly string[] }
  | { type: "configure"; accountKey: string; settings: ModelSelection }
);
export const changeSession = backendRuntime.fn((input: SessionChange) => Effect.flatMap(Backend, (client) => {
  switch (input.type) {
    case "draft": return client["sessions.draft"](input);
    case "rename": return client["sessions.rename"](input);
    case "settle": return client["sessions.settle"](input);
    case "append": return client["sessions.append"](input);
    case "configure": return client["sessions.configure"]({ ...input, ...input.settings });
  }
}).pipe(Effect.timeout("10 seconds")));
export const deleteSession = backendRuntime.fn((input: SessionLocation & { revision: number }) => Effect.flatMap(Backend, (client) => client["sessions.delete"](input)).pipe(Effect.timeout("10 seconds")));
/** Starts "Regenerate title"; the new title arrives with the session list. */
export const regenerateSessionTitle = backendRuntime.fn((location: SessionLocation) => Effect.flatMap(Backend, (client) => client["sessions.regenerateTitle"](location)).pipe(Effect.timeout("10 seconds")));
export const rewindSession = backendRuntime.fn((input: SessionLocation & { revision: number; entryId: string; restoreFiles: boolean }) =>
  Effect.flatMap(Backend, (client) => client["sessions.rewind"](input)).pipe(Effect.timeout("6 minutes")));
export const sessionErrorMessage = (error: unknown) => error instanceof SessionError ? error.message : "Could not reach session storage. Your unsaved text is still here. Try again.";
