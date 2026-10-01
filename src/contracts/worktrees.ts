import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionDocument, SessionError, SessionId, SessionLocation } from "./sessions.js";
import { BranchName, SessionWorkspace, WorkspaceMode, WorkspacePath } from "./session-workspace.js";
import { WorkspaceTarget } from "./workspace-target.js";
import { WorktreeSetupSnapshot } from "./worktree-setup.js";
import { GitPullRequest } from "./git.js";

export class WorktreeError extends Schema.TaggedError<WorktreeError>()("WorktreeError", {
  code: Schema.Literals(["INVALID", "NOT_FOUND", "BUSY", "COMMAND", "STORAGE", "UNAVAILABLE"]), message: Schema.String,
}) {}
/** How a new worktree populates Git submodules. */
export const WorktreeSubmodules = Schema.Literals(["recursive", "top-level", "none"]);
export type WorktreeSubmodules = typeof WorktreeSubmodules.Type;
export const WorktreeCleanupRules = Schema.Struct({
  // Remove worktrees whose sessions have been inactive this many days; null keeps them.
  afterDays: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(3650))),
  onMerge: Schema.Boolean, onDelete: Schema.Boolean, unchanged: Schema.Boolean,
});
export type WorktreeCleanupRules = typeof WorktreeCleanupRules.Type;
export const NO_CLEANUP: WorktreeCleanupRules = { afterDays: null, onMerge: false, onDelete: false, unchanged: false };
export const WorktreeDefaults = Schema.Struct({ defaultMode: WorkspaceMode, startFromOrigin: Schema.Boolean, submodules: WorktreeSubmodules, cleanup: WorktreeCleanupRules });
export type WorktreeDefaults = typeof WorktreeDefaults.Type;
export const DEFAULT_WORKTREE_SETTINGS: WorktreeDefaults = { defaultMode: "local", startFromOrigin: true, submodules: "recursive", cleanup: NO_CLEANUP };
/** A command run in each new worktree, such as installing dependencies. */
export const SetupScript = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)), command: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
  // Hold the agent until the script finishes; otherwise they run side by side.
  wait: Schema.Boolean,
});
export type SetupScript = typeof SetupScript.Type;
export const ProjectCleanup = Schema.Union([Schema.Struct({ mode: Schema.Literal("off") }), Schema.Struct({ mode: Schema.Literal("custom"), rules: WorktreeCleanupRules })]);
export type ProjectCleanup = typeof ProjectCleanup.Type;
/** Per-project overrides; null inherits the defaults. */
export const ProjectWorktreeSettings = Schema.Struct({
  projectId: SessionId, defaultMode: Schema.NullOr(WorkspaceMode), startFromOrigin: Schema.NullOr(Schema.Boolean), submodules: Schema.NullOr(WorktreeSubmodules),
  cleanup: Schema.NullOr(ProjectCleanup), setupScript: Schema.NullOr(SetupScript),
});
export type ProjectWorktreeSettings = typeof ProjectWorktreeSettings.Type;
export const inheritedProjectSettings = (projectId: string): ProjectWorktreeSettings =>
  ({ projectId, defaultMode: null, startFromOrigin: null, submodules: null, cleanup: null, setupScript: null });
export const WorktreeSettings = Schema.Struct({ defaults: WorktreeDefaults, projects: Schema.Array(ProjectWorktreeSettings) });
export type WorktreeSettings = typeof WorktreeSettings.Type;
/** The settings that apply to one project: its own overrides where set, otherwise the defaults (T3 Code's resolution order). */
export type ResolvedWorktreeSettings = { defaultMode: WorkspaceMode; startFromOrigin: boolean; submodules: WorktreeSubmodules; cleanup: WorktreeCleanupRules; setupScript: SetupScript | null };
export function projectSettings(settings: WorktreeSettings, projectId: string): ResolvedWorktreeSettings {
  const project = settings.projects.find(item => item.projectId === projectId);
  const cleanup = project?.cleanup?.mode === "off" ? NO_CLEANUP : project?.cleanup?.mode === "custom" ? project.cleanup.rules : settings.defaults.cleanup;
  return {
    defaultMode: project?.defaultMode ?? settings.defaults.defaultMode,
    startFromOrigin: project?.startFromOrigin ?? settings.defaults.startFromOrigin,
    submodules: project?.submodules ?? settings.defaults.submodules,
    cleanup, setupScript: project?.setupScript ?? null,
  };
}

export const GitRef = Schema.Struct({
  name: BranchName, remote: Schema.NullOr(Schema.String), current: Schema.Boolean, isDefault: Schema.Boolean,
  // The worktree this branch is checked out in, other than the folder that was asked about.
  worktreePath: Schema.NullOr(WorkspacePath),
});
export type GitRef = typeof GitRef.Type;
export const GitRefList = Schema.Struct({ repository: Schema.Boolean, refs: Schema.Array(GitRef), total: Schema.Number, current: Schema.NullOr(BranchName), defaultBranch: Schema.NullOr(BranchName) });
export type GitRefList = typeof GitRefList.Type;
export const PullRequestReference = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048));
export const ResolvedPullRequest = Schema.Struct({ ...GitPullRequest.fields, crossRepository: Schema.Boolean, headOwner: Schema.NullOr(Schema.String) });
export type ResolvedPullRequest = typeof ResolvedPullRequest.Type;
export const PullRequestCheckout = Schema.Struct({
  pullRequest: ResolvedPullRequest, branch: BranchName, worktreePath: Schema.NullOr(WorkspacePath),
  // False when an existing worktree with its own changes was kept as it was.
  isOnPullRequestHead: Schema.Boolean,
});
export type PullRequestCheckout = typeof PullRequestCheckout.Type;

const edit = { ...SessionLocation.fields, revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) };
export const WorktreeRpc = RpcGroup.make(
  Rpc.make("worktrees.settings", { success: WorktreeSettings, error: WorktreeError, stream: true }),
  Rpc.make("worktrees.saveDefaults", { payload: WorktreeDefaults, success: WorktreeSettings, error: WorktreeError }),
  Rpc.make("worktrees.saveProject", { payload: ProjectWorktreeSettings, success: WorktreeSettings, error: WorktreeError }),
  // Chooses where a session works; an existing worktree must belong to the project's repository.
  Rpc.make("worktrees.configure", { payload: { ...edit, workspace: SessionWorkspace }, success: SessionDocument, error: Schema.Union([SessionError, WorktreeError]) }),
  Rpc.make("worktrees.refs", { payload: { ...WorkspaceTarget.fields, query: Schema.String.check(Schema.isMaxLength(256)),
    limit: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)) }, success: GitRefList, error: WorktreeError }),
  // Checks out a branch in the target's folder, creating it first when asked.
  Rpc.make("worktrees.switchRef", { payload: { ...WorkspaceTarget.fields, ref: BranchName, create: Schema.Boolean }, success: Schema.Struct({ branch: BranchName }), error: WorktreeError }),
  // Removes a worktree no remaining session uses, after its session was deleted.
  Rpc.make("worktrees.remove", { payload: { projectId: SessionId, path: WorkspacePath }, success: Schema.Void, error: WorktreeError }),
  Rpc.make("worktrees.setup", { payload: SessionLocation, success: Schema.NullOr(WorktreeSetupSnapshot), error: WorktreeError, stream: true }),
  // Abandons a worktree still being set up and lets the response continue in the project checkout.
  Rpc.make("worktrees.workLocally", { payload: SessionLocation, success: Schema.Boolean, error: WorktreeError }),
  Rpc.make("worktrees.resolvePullRequest", { payload: { projectId: SessionId, reference: PullRequestReference }, success: ResolvedPullRequest, error: WorktreeError }),
  // With a session, records the checkout as where it works and runs the setup script in a new worktree.
  Rpc.make("worktrees.preparePullRequest", { payload: { projectId: SessionId, sessionId: Schema.optionalKey(SessionId), reference: PullRequestReference, mode: Schema.Literals(["local", "worktree"]) },
    success: PullRequestCheckout, error: WorktreeError }),
);
