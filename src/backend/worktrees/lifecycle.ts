import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionLocation } from "../../contracts/sessions.js";
import type { SessionWorkspace } from "../../contracts/session-workspace.js";
import type { BranchNamer } from "../git/writer/writer.js";
import { branchNamePrompt } from "../git/writer/prompts.js";
import type { Sessions } from "../sessions/service.js";
import { generatedWorktreeBranch, isTemporaryWorktreeBranch } from "./branch-names.js";
import { addWorktree, currentBranch, pruneWorktrees, renameBranch } from "./git-worktrees.js";

type Context = { sessions: Pick<Sessions, "updateWorkspace" | "snapshot">; changed: (root: string) => void };
const NAMING_TIMEOUT_MS = 120_000;

/**
 * Recreates a session's worktree whose folder was deleted, from its branch, before the next response, as T3 Code does.
 * Best effort: when it cannot, the response goes ahead and its tools report the missing folder.
 */
export async function restoreMissingWorktree(project: string, workspace: SessionWorkspace, signal: AbortSignal) {
  if (!workspace.worktreePath || !workspace.branch || existsSync(workspace.worktreePath)) return false;
  try {
    await pruneWorktrees(project, signal);
    mkdirSync(dirname(workspace.worktreePath), { recursive: true, mode: 0o700 });
    await addWorktree(project, { path: workspace.worktreePath, ref: workspace.branch }, { signal });
    return true;
  } catch { return false; }
}
/** Renames a worktree's placeholder branch after its first message, with the Git text model; failures leave the placeholder. */
export async function nameWorktreeBranch(context: Context & { namer: BranchNamer; renamed(branch: string): void }, location: SessionLocation, workspace: SessionWorkspace,
  message: { text: string; attachments: readonly { name: string; mimeType: string; sizeBytes: number }[]; images: readonly unknown[] }, signal: AbortSignal) {
  const { branch: from, worktreePath: path } = workspace;
  if (!from || !path || !isTemporaryWorktreeBranch(from)) return;
  try {
    const suggestion = await context.namer.branch(branchNamePrompt({ message: message.text, attachments: message.attachments }), message.images,
      AbortSignal.any([signal, AbortSignal.timeout(NAMING_TIMEOUT_MS)]));
    const renamed = await renameBranch(path, from, generatedWorktreeBranch(suggestion), signal);
    if (!renamed || renamed === from) return;
    context.sessions.updateWorkspace(location, current => current.branch === from && current.worktreePath === path ? { ...current, branch: renamed } : null);
    context.renamed(renamed);
    context.changed(path);
  } catch { /* Naming is a nicety: the worktree keeps working on its placeholder branch, as in T3 Code. */ }
}
/**
 * After a response, adopts the branch the agent switched its worktree to, when no other session shares that worktree.
 * Never adopts a placeholder, and only replaces the branch the session still records.
 */
export async function followWorktreeBranch(context: Context, location: SessionLocation, workspace: SessionWorkspace, signal?: AbortSignal) {
  const { branch: expected, worktreePath: path } = workspace;
  if (!path || !existsSync(path)) return;
  if (context.sessions.snapshot().sessions.filter(session => session.workspace.worktreePath === path).length !== 1) return;
  const branch = await currentBranch(path, signal).catch(() => null);
  if (!branch || branch === expected || isTemporaryWorktreeBranch(branch)) return;
  context.sessions.updateWorkspace(location, current => current.worktreePath === path && current.branch === expected ? { ...current, branch } : null);
}
