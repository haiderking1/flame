import { realpathSync } from "node:fs";
import { LOCAL_WORKSPACE, type SessionWorkspace } from "../../contracts/session-workspace.js";
import { gitCommand } from "../git/command.js";
import { worktreeError } from "./errors.js";
import { hasCommit, isRepository, listWorktrees } from "./git-worktrees.js";

const real = (path: string) => { try { return realpathSync(path); } catch { return null; } };
/**
 * Checks where a session asks to work and returns the workspace to record:
 * - the project checkout, optionally noting the branch chosen there;
 * - a new worktree, which needs, when one is named, a base branch with a commit (unnamed, the first message starts it
 *   from the default branch); outside a repository the session uses the project checkout instead;
 * - an existing worktree of the project's repository (not its main checkout), adopting that worktree's branch.
 */
export async function validateWorkspace(project: string, next: SessionWorkspace, signal?: AbortSignal): Promise<SessionWorkspace> {
  if (next.mode === "local") {
    if (next.worktreePath !== null) throw worktreeError("INVALID", "The project checkout has no worktree path.");
    return { ...LOCAL_WORKSPACE, branch: next.branch };
  }
  const repository = await isRepository(project, signal);
  if (next.worktreePath === null) {
    // As in T3 Code, a new worktree outside a repository falls back to the project checkout instead of blocking the session.
    if (!repository) return LOCAL_WORKSPACE;
    const base = next.baseBranch;
    if (!base) return { mode: "worktree", baseBranch: null, startFromOrigin: next.startFromOrigin, branch: null, worktreePath: null };
    if ((await gitCommand(project, ["check-ref-format", "--branch", base.replace(/^origin\//, "")], { signal, allowed: [0, 1, 128] })).code !== 0)
      throw worktreeError("INVALID", `${base} is not a valid branch name.`);
    if (!await hasCommit(project, base, signal) && !await hasCommit(project, `refs/remotes/origin/${base.replace(/^origin\//, "")}`, signal))
      throw worktreeError("INVALID", `The base branch ${base} has no commit to start a worktree from.`);
    return { mode: "worktree", baseBranch: base, startFromOrigin: next.startFromOrigin, branch: null, worktreePath: null };
  }
  if (!repository) throw worktreeError("INVALID", "A separate worktree requires a Git repository.");
  const wanted = real(next.worktreePath), main = real(project);
  const worktrees = await listWorktrees(project, signal);
  const found = worktrees.find((tree, index) => index > 0 && !tree.bare && !tree.prunable && real(tree.path) === wanted);
  if (!wanted || wanted === main || !found) throw worktreeError("NOT_FOUND", "That worktree no longer belongs to this project's repository. Refresh the branch list.");
  return { mode: "worktree", baseBranch: null, startFromOrigin: false, branch: found.branch, worktreePath: wanted };
}
