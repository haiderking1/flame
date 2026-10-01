import { Schema } from "effect";
import { SessionId } from "./sessions.js";
import { WorkspacePath } from "./session-workspace.js";

/**
 * The folder an action applies to: a session's worktree when it has one, otherwise the project checkout. A new session
 * that has not been created yet names the existing worktree it will use by path, which must belong to the project.
 */
export const WorkspaceTarget = Schema.Struct({ projectId: SessionId, sessionId: Schema.optionalKey(Schema.NullOr(SessionId)), worktreePath: Schema.optionalKey(Schema.NullOr(WorkspacePath)) });
export type WorkspaceTarget = typeof WorkspaceTarget.Type;
