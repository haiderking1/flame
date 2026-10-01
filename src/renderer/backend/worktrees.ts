import { Cause, Effect, Option, Schedule, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { SessionLocation } from "@contracts/sessions";
import { SessionError } from "@contracts/sessions";
import type { SessionWorkspace } from "@contracts/session-workspace";
import { WorktreeError, type ProjectWorktreeSettings, type WorktreeDefaults } from "@contracts/worktrees";
import { Backend, backendRuntime } from "./client";
import { workspaceTarget, type WorkspaceKey } from "./workspaceKey";

export const worktreeSettingsAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, client => client["worktrees.settings"]().pipe(Stream.retry(Schedule.spaced("2 seconds")))))).pipe(Atom.keepAlive);
export const saveWorktreeDefaults = backendRuntime.fn((defaults: WorktreeDefaults) => Effect.flatMap(Backend, client => client["worktrees.saveDefaults"](defaults)).pipe(Effect.timeout("10 seconds")));
export const saveProjectWorktreeSettings = backendRuntime.fn((settings: ProjectWorktreeSettings) => Effect.flatMap(Backend, client => client["worktrees.saveProject"](settings)).pipe(Effect.timeout("10 seconds")));
export const configureWorkspace = backendRuntime.fn((input: SessionLocation & { revision: number; workspace: SessionWorkspace }) =>
  Effect.flatMap(Backend, client => client["worktrees.configure"](input)).pipe(Effect.timeout("30 seconds")));
export const gitRefs = backendRuntime.fn((input: { workspace: WorkspaceKey; query: string; limit: number }) =>
  Effect.flatMap(Backend, client => client["worktrees.refs"]({ ...workspaceTarget(input.workspace), query: input.query, limit: input.limit })).pipe(Effect.timeout("30 seconds")));
export const switchGitRef = backendRuntime.fn((input: { workspace: WorkspaceKey; ref: string; create: boolean }) =>
  Effect.flatMap(Backend, client => client["worktrees.switchRef"]({ ...workspaceTarget(input.workspace), ref: input.ref, create: input.create })).pipe(Effect.timeout("2 minutes")));
export const removeWorktree = backendRuntime.fn((input: { projectId: string; path: string }) => Effect.flatMap(Backend, client => client["worktrees.remove"](input)).pipe(Effect.timeout("5 minutes")));
export const worktreeSetup = Atom.family((location: string) => {
  const [projectId, sessionId] = location.split(":");
  return backendRuntime.atom(Stream.unwrap(Effect.map(Backend, client => client["worktrees.setup"]({ projectId: projectId!, sessionId: sessionId! }).pipe(Stream.retry(Schedule.spaced("2 seconds"))))));
});
export const workLocally = backendRuntime.fn((location: SessionLocation) => Effect.flatMap(Backend, client => client["worktrees.workLocally"](location)).pipe(Effect.timeout("10 seconds")));
export const resolvePullRequest = backendRuntime.fn((input: { projectId: string; reference: string }) => Effect.flatMap(Backend, client => client["worktrees.resolvePullRequest"](input)).pipe(Effect.timeout("2 minutes")));
export const preparePullRequest = backendRuntime.fn((input: { projectId: string; sessionId?: string; reference: string; mode: "local" | "worktree" }) =>
  Effect.flatMap(Backend, client => client["worktrees.preparePullRequest"](input)).pipe(Effect.timeout("10 minutes")));
export function worktreeErrorMessage(error: unknown, fallback = "Could not reach Flame's worktree service. Try again.") {
  const found = error instanceof WorktreeError || error instanceof SessionError ? Option.some(error) : Cause.isCause(error) ? Cause.findErrorOption(error) : Option.none();
  return Option.isSome(found) && (found.value instanceof WorktreeError || found.value instanceof SessionError) ? found.value.message : fallback;
}
