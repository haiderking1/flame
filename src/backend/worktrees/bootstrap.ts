import { mkdirSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { LOCAL_WORKSPACE, pendingWorktree, type SessionWorkspace } from "../../contracts/session-workspace.js";
import type { SessionLocation } from "../../contracts/sessions.js";
import type { WorktreeSettings, WorktreeSubmodules } from "../../contracts/worktrees.js";
import { gitCommand } from "../git/command.js";
import type { Sessions } from "../sessions/service.js";
import { isTemporaryWorktreeBranch, temporaryWorktreeBranch } from "./branch-names.js";
import { errorMessage, WorktreeSetupFailure } from "./errors.js";
import { addWorktree, currentBranch, hasCommit, isRepository, recordMergeBase, removeWorktree, updateSubmodules } from "./git-worktrees.js";
import { defaultBranch } from "../git/branch-state.js";
import { worktreeFolder } from "./paths.js";
import type { WorkspaceRoots } from "./roots.js";
import { runSetupScript } from "./setup-script.js";
import type { SetupRun, SetupTracker } from "./setup-tracker.js";
import { projectSettings } from "../../contracts/worktrees.js";

export type WorktreeContext = {
  sessions: Pick<Sessions, "updateWorkspace" | "read">;
  roots: Pick<WorkspaceRoots, "project">;
  tracker: SetupTracker;
  settings: () => WorktreeSettings;
  // The folder that holds every session worktree.
  directory: string;
  changed: (root: string) => void;
  // Setup scripts that outlive their turn, so shutdown can stop them.
  background: Set<{ controller: AbortController; done: Promise<void> }>;
};
const FETCH_TIMEOUT_MS = 120_000, REMOVE_ATTEMPTS = 4, REMOVE_RETRY_MS = 500;
const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** The base a new worktree checks out: with "start from origin", the latest fetched commit of the branch on origin. */
async function resolveBase(project: string, base: string, startFromOrigin: boolean, run: SetupRun, signal: AbortSignal) {
  const remote = (await gitCommand(project, ["remote", "get-url", "origin"], { signal, allowed: [0, 2, 128] })).code === 0;
  const branch = base.replace(/^origin\//, "");
  if (!startFromOrigin || !remote) { run.stage("fetch", "skipped", startFromOrigin ? "No origin remote" : null); return base; }
  run.stage("fetch", "running", `origin/${branch}`);
  const fetched = await gitCommand(project, ["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`],
    { signal, timeout: FETCH_TIMEOUT_MS, allowed: [0, 1, 128] });
  if (fetched.code !== 0) await gitCommand(project, ["fetch", "--quiet", "--no-tags", "origin"], { signal, timeout: FETCH_TIMEOUT_MS });
  const sha = await gitCommand(project, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`], { signal, allowed: [0, 1, 128] });
  if (sha.code !== 0) { run.stage("fetch", "warning", `origin/${branch} not found, using local branch`); return base; }
  const commit = sha.stdout.toString("utf8").trim();
  run.stage("fetch", "done", `origin/${branch} at ${commit.slice(0, 7)}`);
  return commit;
}
/**
 * Removes what a setup made: its worktree, when one was added, retrying while Git or a scanner still holds files, and its
 * placeholder branch, which `git worktree add -b` may have created even when the checkout then failed.
 */
async function discard(project: string, path: string | null, branch: string) {
  for (let attempt = 1; path; attempt++) {
    try { await removeWorktree(project, path, true); break; }
    catch (error) { if (attempt >= REMOVE_ATTEMPTS) throw error; await delay(REMOVE_RETRY_MS); }
  }
  if (isTemporaryWorktreeBranch(branch)) await gitCommand(project, ["branch", "-D", "--", branch], { allowed: [0, 1] }).catch(() => {});
}
/** Populates submodules as the setup's "submodules" stage; best effort, since the worktree is usable without them. */
export async function populateSubmodules(run: SetupRun, worktree: string, mode: WorktreeSubmodules, signal: AbortSignal) {
  run.stage("submodules", "running");
  try {
    const outcome = await updateSubmodules(worktree, mode, { signal, onLine: line => { const path = /Submodule path '([^']+)'/.exec(line)?.[1]; if (path) run.progress("submodules", null, path); } });
    if (outcome === "updated") run.stage("submodules", "done", null);
    else run.stage("submodules", "skipped", outcome === "absent" ? "none" : "disabled in settings");
  } catch (error) {
    if (signal.aborted) throw error;
    run.stage("submodules", "warning", errorMessage(error));
  }
}
/** Runs the project's setup script in a new worktree as the setup's "setup-script" stage, tracked so shutdown can stop it. */
export function startSetupScript(context: WorktreeContext, run: SetupRun, project: string, worktree: string, command: string) {
  const controller = new AbortController();
  run.stage("setup-script", "running");
  const done = runSetupScript({ command, worktree, projectRoot: project, signal: controller.signal, onLine: line => run.line("setup-script", line) })
    .then(result => {
      if (result.error) run.stage("setup-script", "failed", result.error);
      else if (controller.signal.aborted) run.stage("setup-script", "failed", "Stopped");
      else if (result.exitCode === 0) run.stage("setup-script", "done");
      else run.stage("setup-script", "failed", result.signal ? `Stopped by ${result.signal}` : `exit ${result.exitCode}`);
      context.changed(worktree);
    });
  const task = { controller, done };
  context.background.add(task);
  void done.finally(() => context.background.delete(task));
  return task;
}
/**
 * Creates the session's worktree for the response `turnId`, as T3 Code does on a first message: fetch the base when asked,
 * add the worktree on a placeholder branch, populate submodules, run the setup script, then hand over to the agent. A
 * cancelled turn or a failure removes what was made; "work locally" removes it and lets the response use the project checkout.
 */
export async function bootstrapWorktree(context: WorktreeContext, location: SessionLocation, turnId: string, workspace: SessionWorkspace, signal: AbortSignal) {
  const project = context.roots.project(location.projectId);
  const settings = projectSettings(context.settings(), location.projectId);
  const branch = temporaryWorktreeBranch();
  const script = settings.setupScript;
  const run = context.tracker.begin(location, turnId, { branch, baseRef: workspace.baseBranch, setupScript: script && { name: script.name, command: script.command } });
  const work = AbortSignal.any([signal, run.local.signal]);
  let created: string | null = null;
  try {
    if (!await isRepository(project, work)) {
      // The project stopped being a repository since the choice was made: work in its checkout, as T3 Code does.
      for (const stage of ["fetch", "checkout", "submodules", "setup-script"] as const) run.stage(stage, "skipped", "using project checkout");
      context.sessions.updateWorkspace(location, current => pendingWorktree(current) ? LOCAL_WORKSPACE : null);
      run.uncancellable(); run.stage("agent", "done"); run.finish("done");
      return;
    }
    // Without a chosen base, start from the repository's default branch, else the branch checked out (T3 Code's default).
    const base = workspace.baseBranch ?? await defaultBranch(project, work) ?? await currentBranch(project, work);
    if (!base) throw new WorktreeSetupFailure("Select a base branch before sending in New worktree mode.");
    run.set({ baseRef: base });
    const ref = await resolveBase(project, base, workspace.startFromOrigin, run, work);
    if (!await hasCommit(project, ref, work)) throw new WorktreeSetupFailure(`The base branch ${base} has no commit to start a worktree from.`);
    run.stage("checkout", "running");
    const path = worktreeFolder(context.directory, project, branch);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    await addWorktree(project, { path, ref, newBranch: branch }, { signal: work, onProgress: (percent, completed, total) => run.progress("checkout", percent, `${completed} / ${total} files`) });
    created = real(path);
    await recordMergeBase(project, branch, base, work).catch(() => { /* Only change requests use it. */ });
    const recorded = context.sessions.updateWorkspace(location, current => pendingWorktree(current) ? { ...current, branch, worktreePath: created } : null);
    if (!recorded) throw new WorktreeSetupFailure("Where this session works changed during setup.");
    run.set({ worktreePath: created });
    run.stage("checkout", "done");
    context.changed(created);
    await populateSubmodules(run, created, settings.submodules, work);
    let pendingScript: Promise<void> | null = null;
    if (script) {
      const task = startSetupScript(context, run, project, created, script.command);
      if (script.wait) {
        const stop = () => task.controller.abort();
        work.addEventListener("abort", stop, { once: true });
        try { await task.done; } finally { work.removeEventListener("abort", stop); }
        work.throwIfAborted();
      } else pendingScript = task.done;
    } else run.stage("setup-script", "skipped", "No setup script");
    work.throwIfAborted();
    run.uncancellable();
    run.stage("agent", "running");
    run.stage("agent", "done");
    if (pendingScript) void pendingScript.then(() => run.finish("done"));
    else run.finish("done");
  } catch (error) {
    const local = run.local.signal.aborted && !signal.aborted;
    const failure = local ? null : signal.aborted ? "Worktree setup cancelled." : `Worktree setup failed: ${errorMessage(error)}`;
    try {
      await discard(project, created, branch);
      context.sessions.updateWorkspace(location, current => local ? (current.mode === "worktree" ? LOCAL_WORKSPACE : null)
        : current.worktreePath === created && created ? { ...current, branch: null, worktreePath: null } : null);
    } catch (cleanup) {
      run.finish(local || signal.aborted ? "cancelled" : "failed", `${failure ?? "Worktree setup cancelled."} The worktree could not be removed: ${errorMessage(cleanup)}`);
      throw new WorktreeSetupFailure(`${failure ?? "Worktree setup cancelled."} The partly created worktree at ${created} could not be removed.`);
    }
    if (created) context.changed(created);
    if (local) { run.finish("cancelled", null); return; }
    run.finish(signal.aborted ? "cancelled" : "failed", failure);
    throw new WorktreeSetupFailure(failure!);
  }
}
