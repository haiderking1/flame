import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { LOCAL_WORKSPACE } from "../../contracts/session-workspace.js";
import type { SessionLocation } from "../../contracts/sessions.js";
import type { PullRequestCheckout, ResolvedPullRequest } from "../../contracts/worktrees.js";
import { changeRequestTerminology, detectSourceControl } from "../../contracts/source-control.js";
import { gitCommand, gitText } from "../git/command.js";
import { hostingRemoteUrl } from "../git/branch-state.js";
import { sanitizeBranchFragment } from "../git/branch-names.js";
import { hostingFor, type Hosting } from "../git/hosting/index.js";
import { populateSubmodules, startSetupScript, type WorktreeContext } from "./bootstrap.js";
import { WORKTREE_BRANCH_PREFIX } from "./branch-names.js";
import { worktreeError } from "./errors.js";
import { addWorktree, currentBranch, listWorktrees, removeWorktree } from "./git-worktrees.js";
import { worktreeFolder } from "./paths.js";
import { projectSettings } from "../../contracts/worktrees.js";

const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };
/** The number in `#42`, `42`, a pull or merge request URL, or a `gh pr checkout` / `glab mr checkout` command. */
export function pullRequestNumber(reference: string): number | null {
  const text = reference.trim();
  const command = /^(?:gh\s+pr|glab\s+mr)\s+checkout\s+(\S+)/i.exec(text);
  if (command) return pullRequestNumber(command[1]!);
  const plain = /^#?(\d{1,9})$/.exec(text);
  if (plain) return Number(plain[1]);
  try {
    const url = new URL(text);
    const match = /\/(?:pull|pulls|-\/merge_requests|merge_requests)\/(\d{1,9})(?:\/|$)/.exec(url.pathname);
    return match ? Number(match[1]) : null;
  } catch { return null; }
}
async function projectHosting(project: string, signal?: AbortSignal): Promise<Hosting> {
  const url = await hostingRemoteUrl(project, await currentBranch(project, signal), signal);
  const hosting = hostingFor(url ? detectSourceControl(url)?.kind : null);
  if (!hosting) throw worktreeError("INVALID", "Checking out pull requests needs a GitHub or GitLab remote and its CLI.");
  return hosting;
}
/** Where the provider publishes a change request's head commit in the base repository. */
const headRef = (hosting: Hosting, number: number) => hosting.kind === "gitlab" ? `refs/merge-requests/${number}/head` : `refs/pull/${number}/head`;
export async function resolvePullRequest(project: string, reference: string, signal?: AbortSignal) {
  const number = pullRequestNumber(reference);
  const hosting = await projectHosting(project, signal);
  const { singular } = changeRequestTerminology(hosting.kind);
  if (number === null) throw worktreeError("INVALID", `Enter a ${singular} URL, checkout command, or #number.`);
  return { hosting, pullRequest: await hosting.changeRequest(project, number, signal) };
}
/** Fetches the change request's head commit from origin and returns it. */
async function fetchHead(project: string, hosting: Hosting, number: number, signal?: AbortSignal) {
  const ref = headRef(hosting, number);
  const listed = await gitText(project, ["ls-remote", "origin", ref], { signal, timeout: 60_000 });
  const sha = listed.split(/\s+/)[0];
  if (!sha) throw worktreeError("NOT_FOUND", "The change request's head commit is not available on origin.");
  await gitCommand(project, ["fetch", "--quiet", "--no-tags", "origin", ref], { signal, timeout: 300_000 });
  return sha;
}
const isAncestor = async (cwd: string, ancestor: string, descendant: string, signal?: AbortSignal) =>
  (await gitCommand(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], { signal, allowed: [0, 1, 128] })).code === 0;
/**
 * Checks out a change request for a session, as T3 Code does. Locally it force-checks it out in the project. In a worktree
 * it reuses a worktree already on its branch (moving it to the head only when clean with no local commits), or adds one on
 * `<head>` (same repository) or `flame/pr-<n>/<head>` (fork). When given a session, it records the workspace there and runs
 * the project's setup script in a worktree whose checkout moved.
 */
export async function preparePullRequest(context: WorktreeContext, input: { projectId: string; reference: string; mode: "local" | "worktree"; session: SessionLocation | null },
  signal?: AbortSignal): Promise<PullRequestCheckout> {
  const project = context.roots.project(input.projectId);
  const { hosting, pullRequest } = await resolvePullRequest(project, input.reference, signal);
  if (input.mode === "local") {
    await hosting.checkoutChangeRequest(project, pullRequest.number, null, signal);
    const branch = await currentBranch(project, signal) ?? pullRequest.headBranch;
    if (input.session) context.sessions.updateWorkspace(input.session, () => ({ ...LOCAL_WORKSPACE, branch }));
    context.changed(project);
    return { pullRequest, branch, worktreePath: null, isOnPullRequestHead: true };
  }
  const branch = pullRequest.crossRepository ? `${WORKTREE_BRANCH_PREFIX}/pr-${pullRequest.number}/${sanitizeBranchFragment(pullRequest.headBranch)}` : pullRequest.headBranch;
  const worktrees = await listWorktrees(project, signal);
  if (worktrees[0]?.branch === branch) throw worktreeError("INVALID", `This ${changeRequestTerminology(hosting.kind).singular} branch is already checked out in the main repo. Use Local, or switch the main repo off that branch before creating a worktree session.`);
  const sha = await fetchHead(project, hosting, pullRequest.number, signal);
  const existing = worktrees.slice(1).find(tree => tree.branch === branch && !tree.prunable && existsSync(tree.path));
  let path: string, moved = false, onHead = true;
  if (existing) {
    path = real(existing.path);
    const head = await gitText(path, ["rev-parse", "HEAD"], { signal });
    const clean = !(await gitCommand(path, ["status", "--porcelain=v1", "-z"], { signal })).stdout.length;
    if (head !== sha && clean && await isAncestor(path, head, sha, signal)) { await gitCommand(path, ["merge", "--ff-only", "--quiet", sha], { signal, timeout: 300_000 }); moved = true; }
    onHead = await gitText(path, ["rev-parse", "HEAD"], { signal }) === sha;
  } else {
    const folder = worktreeFolder(context.directory, project, branch);
    mkdirSync(dirname(folder), { recursive: true, mode: 0o700 });
    await addWorktree(project, { path: folder, ref: `${sha}^{commit}` }, { signal });
    path = real(folder);
    try { await hosting.checkoutChangeRequest(path, pullRequest.number, branch, signal); }
    catch (error) { await removeWorktree(project, path, true).catch(() => {}); throw error; }
    moved = true;
  }
  if (input.session) {
    const session = input.session;
    context.sessions.updateWorkspace(session, () => ({ mode: "worktree", baseBranch: null, startFromOrigin: false, branch, worktreePath: path }));
    if (moved) prepareCheckedOutWorktree(context, session, project, path, branch, pullRequest);
  }
  context.changed(path);
  return { pullRequest, branch, worktreePath: path, isOnPullRequestHead: onHead };
}
/** Populates submodules and runs the setup script in a change request's worktree, shown on the session's setup card. */
function prepareCheckedOutWorktree(context: WorktreeContext, session: SessionLocation, project: string, path: string, branch: string, pullRequest: ResolvedPullRequest) {
  const settings = projectSettings(context.settings(), session.projectId);
  const script = settings.setupScript;
  const run = context.tracker.begin(session, `pull-request-${pullRequest.number}`, { branch, baseRef: pullRequest.baseBranch, setupScript: script && { name: script.name, command: script.command } });
  run.set({ worktreePath: path });
  run.stage("fetch", "done", `#${pullRequest.number}`);
  run.stage("checkout", "done");
  void (async () => {
    await populateSubmodules(run, path, settings.submodules, run.local.signal).catch(() => {});
    if (script) await startSetupScript(context, run, project, path, script.command).done;
    else run.stage("setup-script", "skipped", "No setup script");
    run.stage("agent", "skipped", "Starts with your first message");
    run.finish("done");
  })().catch(() => run.finish("failed", "The worktree was checked out, but its setup could not finish."));
}
