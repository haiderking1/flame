import type { SessionLocation } from "../../contracts/sessions.js";
import type { WorkspaceTarget } from "../../contracts/workspace-target.js";
import type { ProjectStore } from "../projects/store.js";
import type { Sessions } from "../sessions/service.js";
import { linkedWorktreeOf } from "./linked-worktree.js";

/**
 * Resolves the folder a session works in: its worktree once one exists, otherwise its project's checkout.
 * Reads the in-memory session index, so tools can ask on every step without opening session databases.
 */
export class WorkspaceRoots {
  constructor(private readonly projects: Pick<ProjectStore, "list">, private readonly sessions: Pick<Sessions, "find" | "rootOf">) {}
  project(projectId: string) {
    const project = this.projects.list().find(project => project.id === projectId);
    if (!project) throw new Error("Project not found");
    return project.path;
  }
  /** A subagent works where its thread does. */
  session(location: SessionLocation) {
    const session = this.sessions.find(this.sessions.rootOf(location));
    if (!session) throw new Error("Session not found");
    return session.workspace.worktreePath ?? this.project(location.projectId);
  }
  target(target: WorkspaceTarget) {
    if (target.sessionId) return this.session({ projectId: target.projectId, sessionId: target.sessionId });
    const project = this.project(target.projectId);
    if (!target.worktreePath) return project;
    const worktree = linkedWorktreeOf(project, target.worktreePath);
    if (!worktree) throw new Error("That folder is not a worktree of this project");
    return worktree;
  }
}
