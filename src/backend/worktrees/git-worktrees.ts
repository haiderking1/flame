import { existsSync } from "node:fs";
import { join } from "node:path";
import { GitError } from "../../contracts/git.js";
import type { WorktreeSubmodules } from "../../contracts/worktrees.js";
import { gitCommand, gitText } from "../git/command.js";
import { availableBranchName } from "./branch-names.js";

const WORKTREE_ADD_TIMEOUT_MS = 300_000, WORKTREE_REMOVE_TIMEOUT_MS = 300_000, SUBMODULE_TIMEOUT_MS = 600_000;
const CHECKOUT_PROGRESS = /Updating files:\s+(\d+)%\s+\((\d+)\/(\d+)\)/;
export type WorktreeInfo = { path: string; branch: string | null; head: string | null; bare: boolean; detached: boolean; prunable: boolean };

/** Every worktree registered with the repository, the main checkout first, from `git worktree list --porcelain -z`. */
export async function listWorktrees(repository: string, signal?: AbortSignal): Promise<WorktreeInfo[]> {
  const output = (await gitCommand(repository, ["worktree", "list", "--porcelain", "-z"], { signal })).stdout.toString("utf8");
  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;
  for (const field of output.split("\0")) {
    if (!field) { if (current) worktrees.push(current); current = null; continue; }
    const space = field.indexOf(" "), key = space < 0 ? field : field.slice(0, space), value = space < 0 ? "" : field.slice(space + 1);
    if (key === "worktree") { if (current) worktrees.push(current); current = { path: value, branch: null, head: null, bare: false, detached: false, prunable: false }; continue; }
    if (!current) continue;
    if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "HEAD") current.head = value;
    else if (key === "bare") current.bare = true;
    else if (key === "detached") current.detached = true;
    else if (key === "prunable") current.prunable = true;
  }
  if (current) worktrees.push(current);
  return worktrees;
}
export async function isRepository(cwd: string, signal?: AbortSignal) {
  return (await gitCommand(cwd, ["rev-parse", "--is-inside-work-tree"], { signal, allowed: [0, 128] })).code === 0;
}
export async function hasCommit(repository: string, ref: string, signal?: AbortSignal) {
  return (await gitCommand(repository, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { signal, allowed: [0, 1, 128] })).code === 0;
}
export async function currentBranch(cwd: string, signal?: AbortSignal) {
  const result = await gitCommand(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], { signal, allowed: [0, 1, 128] });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
}
export async function localBranches(cwd: string, signal?: AbortSignal) {
  return (await gitText(cwd, ["branch", "--list", "--format=%(refname:short)"], { signal })).split("\n").filter(Boolean);
}
/**
 * Adds a worktree at `path` checking out `ref`, or a new branch from it. Git prints checkout progress through the pipe
 * only when told there is no delay; parallel checkout follows the repository's own setting, else Git's automatic choice.
 */
export async function addWorktree(repository: string, input: { path: string; ref: string; newBranch?: string },
  options: { signal?: AbortSignal; onProgress?: (percent: number, completed: number, total: number) => void } = {}) {
  const workers = (await gitCommand(repository, ["config", "--get", "checkout.workers"], { signal: options.signal, allowed: [0, 1] })).stdout.toString("utf8").trim() || "0";
  let pending = "";
  await gitCommand(repository, ["worktree", "add", ...(input.newBranch ? ["-b", input.newBranch] : []), "--", input.path, input.ref], {
    signal: options.signal, timeout: WORKTREE_ADD_TIMEOUT_MS, config: [["checkout.workers", workers]], env: { GIT_PROGRESS_DELAY: "0" },
    onOutput: (stream, text) => {
      if (stream !== "stderr" || !options.onProgress) return;
      // Git redraws progress with carriage returns, so split on both line endings.
      const parts = (pending + text).split(/[\r\n]/);
      pending = parts.pop() ?? "";
      for (const part of parts) {
        const match = CHECKOUT_PROGRESS.exec(part);
        if (match) options.onProgress(Number(match[1]), Number(match[2]), Number(match[3]));
      }
    },
  });
}
/** Populates submodules in a new worktree; "absent" when it has none. A failure is reported, never thrown, by the caller. */
export async function updateSubmodules(worktree: string, mode: WorktreeSubmodules, options: { signal?: AbortSignal; onLine?: (line: string) => void } = {}) {
  if (!existsSync(join(worktree, ".gitmodules"))) return "absent" as const;
  if (mode === "none") return "disabled" as const;
  let pending = "";
  await gitCommand(worktree, ["submodule", "update", "--init", ...(mode === "recursive" ? ["--recursive"] : [])], {
    signal: options.signal, timeout: SUBMODULE_TIMEOUT_MS,
    onOutput: (_stream, text) => {
      const parts = (pending + text).split(/[\r\n]/);
      pending = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) options.onLine?.(part.trim());
    },
  });
  return "updated" as const;
}
/** Removes a worktree; an already-missing folder just has its stale registration pruned. */
export async function removeWorktree(repository: string, path: string, force: boolean, signal?: AbortSignal) {
  const result = await gitCommand(repository, ["worktree", "remove", ...(force ? ["--force"] : []), "--", path], { signal, timeout: WORKTREE_REMOVE_TIMEOUT_MS, allowed: [0, 1, 128] });
  if (result.code === 0) return;
  if (/is not a working tree|cannot remove working tree|not a working tree|No such file/i.test(result.stderr) && !existsSync(path)) {
    await pruneWorktrees(repository, signal);
    return;
  }
  throw new GitError({ code: "COMMAND", message: result.stderr || "Git could not remove the worktree." });
}
export async function pruneWorktrees(repository: string, signal?: AbortSignal) {
  await gitCommand(repository, ["worktree", "prune"], { signal, timeout: 15_000 });
}
/** Renames `from` to `desired`, or a free `-N` variant of it; returns the new name, or null when none was free. */
export async function renameBranch(cwd: string, from: string, desired: string, signal?: AbortSignal) {
  const target = availableBranchName((await localBranches(cwd, signal)).filter(name => name !== from), desired);
  if (!target) return null;
  if (target !== from) await gitCommand(cwd, ["branch", "-m", "--", from, target], { signal });
  return target;
}
/** Records which branch a worktree branch was cut from, as `gh` does, so change requests target it. */
export async function recordMergeBase(repository: string, branch: string, base: string, signal?: AbortSignal) {
  await gitCommand(repository, ["config", `branch.${branch}.gh-merge-base`, base.replace(/^origin\//, "")], { signal });
}
