import { Cause, Effect, Option, Schedule, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { GitError, type GitStart } from "@contracts/git";
import { Backend, backendRuntime } from "./client";
export const gitStatus = backendRuntime.fn((projectId: string) => Effect.flatMap(Backend, client => client["git.status"]({ projectId })).pipe(Effect.timeout("15 seconds")));
export const gitStart = backendRuntime.fn((input: GitStart) => Effect.flatMap(Backend, client => client["git.start"](input)).pipe(Effect.timeout("15 seconds")));
export const gitHosting = backendRuntime.fn(() => Effect.flatMap(Backend, client => client["git.hosting"]()).pipe(Effect.timeout("40 seconds")));
export const gitOpen = backendRuntime.fn((input: { projectId: string; path: string }) => Effect.flatMap(Backend, client => client["git.open"](input)).pipe(Effect.timeout("15 seconds")));
export const gitFile = backendRuntime.fn((input: { projectId: string; path: string; mode: "working" | "staged" }) => Effect.flatMap(Backend, client => client["git.file"](input)).pipe(Effect.timeout("20 seconds")));
export const gitOperations = Atom.family((projectId: string) => backendRuntime.atom(Stream.unwrap(Effect.map(Backend, client => client["git.watch"]({ projectId }).pipe(Stream.retry(Schedule.spaced("2 seconds")))))));
// Revision that advances whenever agent tools may have changed this project's files.
export const gitChanges = Atom.family((projectId: string) => backendRuntime.atom(Stream.unwrap(Effect.map(Backend, client => client["git.changes"]({ projectId }).pipe(Stream.retry(Schedule.spaced("2 seconds")))))));
export function gitRejection(error: unknown): GitError | null {
  if (error instanceof GitError) return error;
  if (Cause.isCause(error)) { const found = Cause.findErrorOption(error); if (Option.isSome(found) && found.value instanceof GitError) return found.value; }
  return null;
}
export function gitErrorMessage(error: unknown) {
  if (error instanceof GitError) return error.message;
  if (Cause.isCause(error)) { const found = Cause.findErrorOption(error); if (Option.isSome(found) && found.value instanceof GitError) return found.value.message; }
  return "Could not reach Git services. Refresh to check whether the action was accepted before trying again.";
}
