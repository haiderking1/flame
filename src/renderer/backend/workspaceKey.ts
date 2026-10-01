import type { WorkspaceTarget } from "@contracts/workspace-target";

/**
 * Identifies the folder Git, the diff and file search apply to: a project's checkout ("<projectId>"), a session's
 * worktree ("<projectId>:<sessionId>"), or an existing worktree a new session will use ("<projectId>#<path>").
 * A string, so it can key caches and atom families. Project and session ids are UUIDs, so the separator is at 36.
 */
export type WorkspaceKey = string;
export const workspaceKey = (projectId: string, worktreeSessionId: string | null = null): WorkspaceKey => worktreeSessionId ? `${projectId}:${worktreeSessionId}` : projectId;
export const worktreeKey = (projectId: string, worktreePath: string): WorkspaceKey => `${projectId}#${worktreePath}`;
export function workspaceTarget(key: WorkspaceKey): WorkspaceTarget {
  const projectId = key.slice(0, 36), rest = key.slice(37);
  return key[36] === ":" ? { projectId, sessionId: rest } : key[36] === "#" ? { projectId, worktreePath: rest } : { projectId };
}
export const workspaceProject = (key: WorkspaceKey) => key.slice(0, 36);
