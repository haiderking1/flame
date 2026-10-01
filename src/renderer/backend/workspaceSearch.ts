import { Cause, Effect, Option } from "effect";
import { WorkspaceSearchError } from "@contracts/workspace-search";
import { Backend, backendRuntime } from "./client";

// The first search of a project waits for its index (up to 15 seconds on the backend).
export const searchWorkspace = backendRuntime.fn((input: { projectId: string; query: string; limit: number }) =>
  Effect.flatMap(Backend, client => client["workspace.searchEntries"](input)).pipe(Effect.timeout("20 seconds")));
export function workspaceSearchMessage(error: unknown) {
  const found = error instanceof WorkspaceSearchError ? Option.some(error) : Cause.isCause(error) ? Cause.findErrorOption(error) : Option.none();
  return Option.isSome(found) && found.value instanceof WorkspaceSearchError ? found.value.message : "Could not search project files. Try again.";
}
