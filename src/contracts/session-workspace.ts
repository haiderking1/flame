import { Schema } from "effect";

/** Where a session's agent works: the project's own checkout, or a Git worktree of it on its own branch. */
export const WorkspaceMode = Schema.Literals(["local", "worktree"]);
export type WorkspaceMode = typeof WorkspaceMode.Type;
export const BranchName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const WorkspacePath = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
export const SessionWorkspace = Schema.Struct({
  mode: WorkspaceMode,
  // The branch a new worktree starts from, until the worktree exists; null in the project checkout.
  baseBranch: Schema.NullOr(BranchName),
  // Start a new worktree from the base branch's latest commit on origin rather than the local branch.
  startFromOrigin: Schema.Boolean,
  // The session's branch: its worktree's branch, or the branch last chosen for the project checkout.
  branch: Schema.NullOr(BranchName),
  // Null until the worktree is created, and always in the project checkout.
  worktreePath: Schema.NullOr(WorkspacePath),
});
export type SessionWorkspace = typeof SessionWorkspace.Type;
export const LOCAL_WORKSPACE: SessionWorkspace = { mode: "local", baseBranch: null, startFromOrigin: false, branch: null, worktreePath: null };
/** A worktree that this session will create when its first message is sent. */
export const pendingWorktree = (workspace: SessionWorkspace) => workspace.mode === "worktree" && workspace.worktreePath === null;
