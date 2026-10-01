import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionId } from "./sessions.js";
import { ModelSelection } from "./models.js";
import { SourceControlProvider } from "./source-control.js";
import { WorkspaceTarget } from "./workspace-target.js";
const Path = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096));
export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  code: Schema.Literals(["INVALID", "NOT_FOUND", "BUSY", "COMMAND", "STORAGE", "UNAVAILABLE"]), message: Schema.String,
}) {}
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const GitLineStats = Schema.Struct({ additions: Schema.NullOr(Count), deletions: Schema.NullOr(Count) });
export type GitLineStats = typeof GitLineStats.Type;
export const GitFile = Schema.Struct({ path: Path, originalPath: Schema.NullOr(Path), index: Schema.String, worktree: Schema.String,
  stagedStats: Schema.optionalKey(Schema.NullOr(GitLineStats)), workingStats: Schema.optionalKey(Schema.NullOr(GitLineStats)),
  // Opaque; changes whenever the staged blob or the on-disk file changes, even when line counts do not.
  version: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
});
export const GitPullRequest = Schema.Struct({ number: Count, title: Schema.String, url: Schema.String, baseBranch: Schema.String, headBranch: Schema.String,
  state: Schema.Literals(["open", "closed", "merged"]) });
export type GitPullRequest = typeof GitPullRequest.Type;
export const GitStatus = Schema.Struct({ projectId: SessionId, repository: Schema.Boolean, root: Schema.NullOr(Path), branch: Schema.NullOr(Schema.String), upstream: Schema.NullOr(Schema.String), remotes: Schema.Array(Schema.String), files: Schema.Array(GitFile),
  // Commits ahead of/behind the upstream; without an upstream, ahead counts commits not yet on the base branch.
  ahead: Count, behind: Count, aheadOfDefault: Count, defaultBranch: Schema.NullOr(Schema.String), isDefaultBranch: Schema.Boolean,
  // An "origin" remote exists; push and change requests target it when no upstream is set.
  hasPrimaryRemote: Schema.Boolean, provider: Schema.NullOr(SourceControlProvider), pr: Schema.NullOr(GitPullRequest) });
export type GitStatus = typeof GitStatus.Type;
export const GitAction = Schema.Literals(["init", "commit", "commit_push", "commit_push_pr", "push", "create_pr", "pull", "publish"]);
export type GitAction = typeof GitAction.Type;
const Name = Schema.String.check(Schema.isMaxLength(256));
export const GitPublish = Schema.Struct({ provider: Schema.Literals(["github", "gitlab"]), repository: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(256)),
  visibility: Schema.Literals(["private", "public"]), remote: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)), protocol: Schema.Literals(["ssh", "https"]) });
export type GitPublish = typeof GitPublish.Type;
export const GitStart = Schema.Struct({ ...WorkspaceTarget.fields, requestId: SessionId, action: GitAction,
  // Empty asks the selected model to write the commit message.
  message: Schema.String.check(Schema.isMaxLength(10_000)),
  // Null commits every change; otherwise exactly these paths are staged and committed.
  filePaths: Schema.NullOr(Schema.Array(Path).check(Schema.isMinLength(1), Schema.isMaxLength(10_000))),
  featureBranch: Schema.Boolean,
  // The branch the user confirmed; the action refuses to run if HEAD has moved since.
  expectedBranch: Schema.NullOr(Name), model: Schema.NullOr(ModelSelection), publish: Schema.NullOr(GitPublish),
});
export type GitStart = typeof GitStart.Type;
export const GitPhase = Schema.Literals(["init", "branch", "commit", "push", "pr", "pull", "publish"]);
export type GitPhase = typeof GitPhase.Type;
export const GitToastCta = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("none") }),
  Schema.Struct({ kind: Schema.Literal("run_action"), label: Schema.String, action: Schema.Literals(["push", "create_pr"]) }),
  Schema.Struct({ kind: Schema.Literal("open_pr"), label: Schema.String, url: Schema.String }),
]);
export type GitToastCta = typeof GitToastCta.Type;
export const GitResult = Schema.Struct({
  branch: Schema.NullOr(Schema.String),
  commit: Schema.NullOr(Schema.Struct({ sha: Schema.String, subject: Schema.String })),
  push: Schema.NullOr(Schema.Struct({ branch: Schema.String, upstream: Schema.String, setUpstream: Schema.Boolean, skipped: Schema.Boolean })),
  pr: Schema.NullOr(Schema.Struct({ status: Schema.Literals(["created", "opened_existing"]), number: Schema.NullOr(Count), url: Schema.NullOr(Schema.String), title: Schema.String, baseBranch: Schema.String, headBranch: Schema.String })),
  pull: Schema.NullOr(Schema.Struct({ updated: Schema.Boolean, branch: Schema.String, upstream: Schema.String })),
  publish: Schema.NullOr(Schema.Struct({ repository: Schema.String, url: Schema.String, remote: Schema.String, pushed: Schema.Boolean, branch: Schema.String })),
  toast: Schema.Struct({ title: Schema.String, description: Schema.NullOr(Schema.String), cta: GitToastCta }),
});
export type GitResult = typeof GitResult.Type;
export const GitHook = Schema.Struct({ name: Schema.String, startedAt: Schema.Number, output: Schema.NullOr(Schema.String) });
export const GitOperation = Schema.Struct({ ...GitStart.fields, state: Schema.Literals(["running", "completed", "failed", "interrupted"]),
  phase: Schema.String, phases: Schema.Array(GitPhase), phaseStartedAt: Schema.Number, hook: Schema.NullOr(GitHook),
  detail: Schema.NullOr(Schema.String), commit: Schema.NullOr(Schema.String), result: Schema.NullOr(GitResult), createdAt: Schema.Number, updatedAt: Schema.Number,
});
export type GitOperation = typeof GitOperation.Type;
export const GitHosting = Schema.Struct({ kind: Schema.Literals(["github", "gitlab"]), name: Schema.String, host: Schema.String, ready: Schema.Boolean,
  account: Schema.NullOr(Schema.String), hint: Schema.NullOr(Schema.String),
  // The Git protocol the CLI is configured to use; new remotes default to it.
  protocol: Schema.Literals(["ssh", "https"]) });
export type GitHosting = typeof GitHosting.Type;
export const GitFileView = Schema.Struct({ path: Path, beforePath: Path, before: Schema.String, after: Schema.String, binary: Schema.Boolean, mode: Schema.Literals(["working", "staged"]), version: Schema.String });
export type GitFileView = typeof GitFileView.Type;
export const GitRpc = RpcGroup.make(
  Rpc.make("git.status", { payload: WorkspaceTarget, success: GitStatus, error: GitError }),
  Rpc.make("git.start", { payload: GitStart, success: GitOperation, error: GitError }),
  Rpc.make("git.watch", { payload: WorkspaceTarget, success: Schema.Array(GitOperation), error: GitError, stream: true }),
  Rpc.make("git.file", { payload: { ...WorkspaceTarget.fields, path: Path, mode: Schema.Literals(["working", "staged"]) }, success: GitFileView, error: GitError }),
  // Advances when agent tools may have changed files in the target's folder; clients recheck status on change.
  Rpc.make("git.changes", { payload: WorkspaceTarget, success: Schema.Number, stream: true }),
  // Readiness of the hosting CLIs used to publish repositories and open change requests.
  Rpc.make("git.hosting", { success: Schema.Array(GitHosting), error: GitError }),
  // Opens a repository file in the user's default application.
  Rpc.make("git.open", { payload: { ...WorkspaceTarget.fields, path: Path }, success: Schema.Void, error: GitError }),
);
