import { Schema } from "effect";
import { BranchName, WorkspacePath } from "./session-workspace.js";

/** Progress of creating a session's worktree on its first message, in the order the stages run (as in T3 Code). */
export const WorktreeSetupStageId = Schema.Literals(["fetch", "checkout", "submodules", "setup-script", "agent"]);
export type WorktreeSetupStageId = typeof WorktreeSetupStageId.Type;
export const WORKTREE_SETUP_STAGES: readonly WorktreeSetupStageId[] = ["fetch", "checkout", "submodules", "setup-script", "agent"];
export const WorktreeSetupStageStatus = Schema.Literals(["pending", "running", "done", "skipped", "warning", "failed"]);
export type WorktreeSetupStageStatus = typeof WorktreeSetupStageStatus.Type;
export const WORKTREE_SETUP_TAIL_LINES = 200;
const Time = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const WorktreeSetupStage = Schema.Struct({
  id: WorktreeSetupStageId, status: WorktreeSetupStageStatus, startedAt: Schema.NullOr(Time), endedAt: Schema.NullOr(Time),
  percent: Schema.NullOr(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100))),
  detail: Schema.NullOr(Schema.String.check(Schema.isMaxLength(200))),
  // The latest output lines, for the setup script.
  tail: Schema.Array(Schema.String.check(Schema.isMaxLength(400))).check(Schema.isMaxLength(WORKTREE_SETUP_TAIL_LINES)),
});
export type WorktreeSetupStage = typeof WorktreeSetupStage.Type;
export const WorktreeSetupPhase = Schema.Literals(["running", "done", "failed", "cancelled"]);
export type WorktreeSetupPhase = typeof WorktreeSetupPhase.Type;
export const WorktreeSetupSnapshot = Schema.Struct({
  // The response whose first message started this setup.
  turnId: Schema.String, phase: WorktreeSetupPhase, startedAt: Time, endedAt: Schema.NullOr(Time),
  branch: Schema.NullOr(BranchName), baseRef: Schema.NullOr(BranchName), worktreePath: Schema.NullOr(WorkspacePath),
  setupScript: Schema.NullOr(Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(120)), command: Schema.String.check(Schema.isMaxLength(10_000)) })),
  stages: Schema.Array(WorktreeSetupStage), error: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
  // Increases with every update, so clients can drop stale snapshots.
  sequence: Time,
});
export type WorktreeSetupSnapshot = typeof WorktreeSetupSnapshot.Type;
export const worktreeSetupStageLabel = (id: WorktreeSetupStageId) => ({
  fetch: "Fetch base branch", checkout: "Check out files", submodules: "Init submodules", "setup-script": "Run setup script", agent: "Start agent",
})[id];
