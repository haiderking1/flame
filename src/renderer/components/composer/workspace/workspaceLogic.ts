import type { SessionSummary } from "@contracts/sessions";
import type { SessionWorkspace } from "@contracts/session-workspace";
import type { WorktreeSetupSnapshot } from "@contracts/worktree-setup";
import type { GitRef } from "@contracts/worktrees";

/** Toolbar wording and choices ported from T3 Code's BranchToolbar logic. */
export const modeLabel = (mode: SessionWorkspace["mode"]) => mode === "worktree" ? "New worktree" : "Current checkout";
export const currentWorkspaceLabel = (worktreePath: string | null) => worktreePath ? "Current worktree" : modeLabel("local");
/** A session locked in worktree mode with no path is still creating its worktree, so it reads as a new worktree. */
export function lockedWorkspaceLabel(workspace: SessionWorkspace) {
  if (workspace.worktreePath) return "Worktree";
  return workspace.mode === "worktree" ? modeLabel("worktree") : "Local checkout";
}
export const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
export type PreviousWorktree = { branch: string | null; worktreePath: string };
/** The most recently active worktree in the project that the composer is not already using. */
export function previousWorktree(sessions: readonly SessionSummary[], projectId: string, currentPath: string | null): PreviousWorktree | null {
  let latest: (PreviousWorktree & { updatedAt: number }) | null = null;
  for (const session of sessions) {
    const { worktreePath, branch } = session.workspace;
    if (session.projectId !== projectId || !worktreePath || worktreePath === currentPath || session.settledAt !== null) continue;
    if (!latest || session.updatedAt > latest.updatedAt) latest = { branch, worktreePath, updatedAt: session.updatedAt };
  }
  return latest && { branch: latest.branch, worktreePath: latest.worktreePath };
}
export const previousWorktreeLabel = (seed: PreviousWorktree) => seed.branch ? `Previous worktree (${seed.branch})` : "Previous worktree";
/** The branch button: the base a new worktree starts from ("From …"), otherwise the branch checked out. */
export function branchTriggerLabel(workspace: SessionWorkspace, current: string | null) {
  if (workspace.mode === "worktree" && !workspace.worktreePath) {
    const base = workspace.baseBranch;
    if (!base) return "Select ref";
    return `From ${workspace.startFromOrigin && !base.startsWith("origin/") ? `origin/${base}` : base}`;
  }
  return current ?? workspace.branch ?? "Select ref";
}
/**
 * What choosing a branch does, as in T3 Code: a branch that lives in another worktree moves the session there (the
 * project checkout when that is where it lives) without checking anything out; the default branch takes a worktree
 * session back to the project checkout and checks it out there; any other branch is checked out where the session works.
 */
export function branchSelection(workspace: SessionWorkspace, projectPath: string | null, ref: Pick<GitRef, "isDefault" | "worktreePath">) {
  if (ref.worktreePath) return { worktreePath: ref.worktreePath === projectPath ? null : ref.worktreePath, checkout: false };
  return { worktreePath: workspace.worktreePath !== null && ref.isDefault ? null : workspace.worktreePath, checkout: true };
}
/** The workspace a session moves to: an existing worktree, or the project checkout. */
export const movedWorkspace = (worktreePath: string | null, branch: string | null): SessionWorkspace => worktreePath
  ? { mode: "worktree", baseBranch: null, startFromOrigin: false, branch, worktreePath }
  : { mode: "local", baseBranch: null, startFromOrigin: false, branch, worktreePath: null };
/**
 * Which setup the timeline shows, as T3 Code decides: a running setup always; once the agent has the turn, a clean finish
 * disappears while a failed script stays; failed and cancelled setups stay until a follow-up message clears them.
 */
export function visibleSetup(snapshot: WorktreeSetupSnapshot | null) {
  if (!snapshot) return null;
  if (snapshot.phase !== "done") return snapshot;
  if (!agentStarted(snapshot)) return snapshot;
  return snapshot.stages.some(stage => stage.status === "failed") ? snapshot : null;
}
export const agentStarted = (snapshot: WorktreeSetupSnapshot) => snapshot.stages.some(stage => stage.id === "agent" && (stage.status === "done" || stage.status === "skipped"));
/** A deleted session's worktree that no other session uses, which deleting the session may remove too. */
export function orphanedWorktree(session: SessionSummary, sessions: readonly SessionSummary[]) {
  const path = session.workspace.worktreePath;
  if (!path) return null;
  return sessions.some(other => other.workspace.worktreePath === path && (other.sessionId !== session.sessionId || other.projectId !== session.projectId)) ? null : path;
}
/** True when the query looks like a change request reference rather than a branch name. */
export const looksLikePullRequest = (query: string) => /^#\d+$|^(?:gh\s+pr|glab\s+mr)\s+checkout\s+\S+|^https?:\/\/\S+\/(?:pull|pulls|merge_requests)\/\d+/i.test(query.trim());
/** A thread in the project checkout whose branch is no longer the one checked out (T3 Code's local branch mismatch). */
export function branchMismatch(workspace: SessionWorkspace, currentBranch: string | null) {
  if (workspace.mode !== "local" || workspace.worktreePath || !workspace.branch || !currentBranch || workspace.branch === currentBranch) return null;
  return { threadBranch: workspace.branch, currentBranch };
}
export const mismatchKey = (sessionId: string, mismatch: { threadBranch: string; currentBranch: string }) => `${sessionId}:${mismatch.threadBranch}:${mismatch.currentBranch}`;
/** The notice waits until the user starts writing, then stays for that mismatch until it changes or is dismissed. */
export const showMismatch = (input: { dismissed: boolean; composerHasContent: boolean; shown: boolean }) => !input.dismissed && (input.composerHasContent || input.shown);
