import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionId } from "./sessions.js";

export const WORKSPACE_SEARCH_MAX_LIMIT = 200;
export const WorkspaceEntryKind = Schema.Literals(["file", "directory"]);
export type WorkspaceEntryKind = typeof WorkspaceEntryKind.Type;
/** A project-relative POSIX path; directories carry no trailing slash. */
export const WorkspaceEntry = Schema.Struct({ path: Schema.String, kind: WorkspaceEntryKind });
export type WorkspaceEntry = typeof WorkspaceEntry.Type;
export const WorkspaceSearchResult = Schema.Struct({ entries: Schema.Array(WorkspaceEntry), truncated: Schema.Boolean });
export type WorkspaceSearchResult = typeof WorkspaceSearchResult.Type;
export class WorkspaceSearchError extends Schema.TaggedError<WorkspaceSearchError>()("WorkspaceSearchError", {
  code: Schema.Literals(["NOT_FOUND", "INDEXING", "UNAVAILABLE"]), message: Schema.String,
}) {}
export const WorkspaceSearchRpc = RpcGroup.make(
  Rpc.make("workspace.searchEntries", {
    payload: {
      projectId: SessionId, query: Schema.String.check(Schema.isMaxLength(256)),
      limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(WORKSPACE_SEARCH_MAX_LIMIT)),
    },
    success: WorkspaceSearchResult, error: WorkspaceSearchError,
  }),
);
