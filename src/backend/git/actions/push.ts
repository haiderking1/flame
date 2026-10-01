import { GitError } from "../../../contracts/git.js";
import { remoteHost, remoteRepository } from "../../../contracts/source-control.js";
import { gitCommand } from "../command.js";
import { PRIMARY_REMOTE } from "../branch-state.js";

export type PushResult = { branch: string; upstream: string; setUpstream: boolean; skipped: boolean };
const SAFE_PUSH = ["--no-force", "--no-follow-tags", "--recurse-submodules=no"];
async function config(root: string, key: string, signal: AbortSignal) {
  const result = await gitCommand(root, ["config", "--get", key], { signal, allowed: [0, 1] });
  return result.code === 0 ? result.stdout.toString("utf8").trim() || null : null;
}
const SSH_FAILURE = /Host key verification failed|Permission denied \(publickey|Could not read from remote repository|ssh: connect to host/i;
/** For an SSH remote that cannot authenticate, the command that switches it to HTTPS (which the hosting CLI can sign in). */
async function sshAdvice(root: string, remote: string, signal: AbortSignal) {
  const url = (await gitCommand(root, ["remote", "get-url", remote], { signal, allowed: [0, 2, 128] })).stdout.toString("utf8").trim();
  if (!/^(ssh:\/\/|[^@/\s]+@[^:/\s]+:)/.test(url)) return null;
  const host = remoteHost(url), repository = remoteRepository(url);
  const https = host && repository ? `https://${host}/${repository}.git` : null;
  return `This remote uses SSH, which isn't set up on this computer.${https ? ` Switch it to HTTPS with \`git remote set-url ${remote} ${https}\`, then retry.` : " Set up an SSH key or switch the remote to HTTPS, then retry."}`;
}
async function push(root: string, remote: string, target: string, setUpstream: boolean, signal: AbortSignal) {
  if (remote.startsWith("-") || target.startsWith("-")) throw new GitError({ code: "INVALID", message: "The remote or branch name is not safe to push to." });
  try {
    await gitCommand(root, ["push", ...SAFE_PUSH, ...(setUpstream ? ["--set-upstream"] : []), "--", remote, `HEAD:refs/heads/${target}`],
      { signal, timeout: 15 * 60_000, config: [[`remote.${remote}.mirror`, "false"], ["push.followTags", "false"]] });
  } catch (error) {
    if (!(error instanceof GitError) || error.code !== "COMMAND" || !SSH_FAILURE.test(error.message)) throw error;
    const advice = await sshAdvice(root, remote, signal).catch(() => null);
    throw advice ? new GitError({ code: "COMMAND", message: advice }) : error;
  }
}
/**
 * Pushes the current branch the way t3code does: to its upstream when it tracks a same-named branch, otherwise to
 * its own name on the push remote with tracking set up. A branch cut from another (e.g. origin/main) is never
 * pushed onto that base; the base is remembered as the change request's merge base instead.
 */
export async function pushCurrentBranch(root: string, state: { branch: string | null; upstream: string | null; remotes: readonly string[]; ahead: number; behind: number }, signal: AbortSignal): Promise<PushResult> {
  const branch = state.branch;
  if (!branch) throw new GitError({ code: "INVALID", message: "Cannot push from detached HEAD." });
  const upstreamRemote = state.upstream ? [...state.remotes].sort((a, b) => b.length - a.length).find(name => state.upstream!.startsWith(`${name}/`)) ?? null : null;
  if (state.upstream && upstreamRemote) {
    const upstreamBranch = state.upstream.slice(upstreamRemote.length + 1);
    if (upstreamBranch === branch) {
      if (state.ahead === 0 && state.behind === 0) return { branch, upstream: state.upstream, setUpstream: false, skipped: true };
      await push(root, upstreamRemote, upstreamBranch, false, signal);
      return { branch, upstream: state.upstream, setUpstream: false, skipped: false };
    }
    if (!await config(root, `branch.${branch}.gh-merge-base`, signal)) await gitCommand(root, ["config", `branch.${branch}.gh-merge-base`, upstreamBranch], { signal });
    const remote = await config(root, `branch.${branch}.pushRemote`, signal) ?? upstreamRemote;
    await push(root, remote, branch, true, signal);
    return { branch, upstream: `${remote}/${branch}`, setUpstream: true, skipped: false };
  }
  const remote = await config(root, `branch.${branch}.pushRemote`, signal) ?? await config(root, "remote.pushDefault", signal)
    ?? (state.remotes.includes(PRIMARY_REMOTE) ? PRIMARY_REMOTE : state.remotes[0] ?? null);
  if (!remote) throw new GitError({ code: "INVALID", message: "Cannot push because no git remote is configured for this repository." });
  const published = await gitCommand(root, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`], { signal, allowed: [0, 1] });
  if (published.code === 0 && published.stdout.toString("utf8").trim() === (await gitCommand(root, ["rev-parse", "HEAD"], { signal })).stdout.toString("utf8").trim()) {
    await gitCommand(root, ["branch", `--set-upstream-to=${remote}/${branch}`, branch], { signal });
    return { branch, upstream: `${remote}/${branch}`, setUpstream: true, skipped: true };
  }
  await push(root, remote, branch, true, signal);
  return { branch, upstream: `${remote}/${branch}`, setUpstream: true, skipped: false };
}
