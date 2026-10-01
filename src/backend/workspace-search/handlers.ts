import { Effect } from "effect";
import { WorkspaceSearchError, WorkspaceSearchRpc } from "../../contracts/workspace-search.js";
import type { WorkspaceSearch } from "./service.js";

export function workspaceSearchHandlers(search: WorkspaceSearch) {
  return WorkspaceSearchRpc.toLayer({
    "workspace.searchEntries": ({ query, limit, ...target }) => Effect.tryPromise({
      try: () => search.search(target, query, limit),
      catch: error => error instanceof WorkspaceSearchError ? error : new WorkspaceSearchError({ code: "UNAVAILABLE", message: "File search failed. Try again." }),
    }),
  });
}
