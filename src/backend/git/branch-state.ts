import { detectSourceControl, type SourceControlProvider } from "../../contracts/source-control.js";
import { gitCommand } from "./command.js";

export type BranchState = { ahead: number; behind: number; aheadOfDefault: number; defaultBranch: string | null; isDefaultBranch: boolean; hasPrimaryRemote: boolean; provider: SourceControlProvider | null };
export const PRIMARY_REMOTE = "origin";
const line = (output: Buffer) => output.toString("utf8").trim();

async function config(root: string, key: string, signal?: AbortSignal) {
  const result = await gitCommand(root, ["config", "--get", key], { signal, allowed: [0, 1] });
  return result.code === 0 ? line(result.stdout) || null : null;
}
async function refExists(root: string, ref: string, signal?: AbortSignal) {
  return (await gitCommand(root, ["show-ref", "--verify", "--quiet", ref], { signal, allowed: [0, 1] })).code === 0;
}
/** The primary remote's default branch from refs/remotes/origin/HEAD, or null when the remote never advertised one. */
export async function defaultBranch(root: string, signal?: AbortSignal) {
  const head = await gitCommand(root, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${PRIMARY_REMOTE}/HEAD`], { signal, allowed: [0, 1, 128] });
  const name = head.code === 0 ? line(head.stdout) : "";
  return name.startsWith(`${PRIMARY_REMOTE}/`) ? name.slice(PRIMARY_REMOTE.length + 1) || null : null;
}
export const isDefaultBranch = (branch: string | null, base: string | null) => !!branch && (base ? branch === base : branch === "main" || branch === "master");
/**
 * The branch this one was cut from when it has no upstream: a recorded merge base, then the remote default, then main/master.
 * Returns a ref that exists, preferring the remote-tracking copy.
 */
export async function baseRef(root: string, branch: string, remoteDefault: string | null, signal?: AbortSignal) {
  const candidates = [await config(root, `branch.${branch}.gh-merge-base`, signal), remoteDefault, "main", "master"];
  for (const candidate of new Set(candidates)) {
    if (!candidate || candidate === branch) continue;
    if (await refExists(root, `refs/remotes/${PRIMARY_REMOTE}/${candidate}`, signal)) return { name: candidate, ref: `refs/remotes/${PRIMARY_REMOTE}/${candidate}` };
    if (await refExists(root, `refs/heads/${candidate}`, signal)) return { name: candidate, ref: `refs/heads/${candidate}` };
  }
  return null;
}
async function count(root: string, range: string, signal?: AbortSignal) {
  const result = await gitCommand(root, ["rev-list", "--count", range, "--"], { signal, allowed: [0, 128] });
  return result.code === 0 ? Number.parseInt(line(result.stdout), 10) || 0 : 0;
}
/** Commits on HEAD that are not on the base branch; every local commit when there is no base to compare with. */
async function aheadOfBase(root: string, branch: string, remoteDefault: string | null, signal?: AbortSignal) {
  const base = await baseRef(root, branch, remoteDefault, signal);
  return base ? count(root, `${base.ref}..HEAD`, signal) : count(root, "HEAD", signal);
}
/** Remote URL that identifies the hosting provider: the branch's own remote, else origin. */
export async function hostingRemoteUrl(root: string, branch: string | null, signal?: AbortSignal) {
  const remote = (branch && await config(root, `branch.${branch}.remote`, signal)) || PRIMARY_REMOTE;
  return await config(root, `remote.${remote}.url`, signal) ?? (remote === PRIMARY_REMOTE ? null : await config(root, `remote.${PRIMARY_REMOTE}.url`, signal));
}
export async function branchState(root: string, branch: string | null, upstream: string | null, remotes: readonly string[], signal?: AbortSignal): Promise<BranchState> {
  const [base, url] = await Promise.all([defaultBranch(root, signal), hostingRemoteUrl(root, branch, signal)]);
  const onDefault = isDefaultBranch(branch, base);
  let ahead = 0, behind = 0, aheadOfDefault = 0;
  if (branch) {
    const fromBase = onDefault ? Promise.resolve(0) : aheadOfBase(root, branch, base, signal);
    if (upstream) {
      const counts = await gitCommand(root, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}", "--"], { signal, allowed: [0, 128] });
      const [left, right] = counts.code === 0 ? line(counts.stdout).split(/\s+/).map(value => Number.parseInt(value, 10) || 0) : [0, 0];
      ahead = left ?? 0; behind = right ?? 0;
      aheadOfDefault = await fromBase;
    } else {
      aheadOfDefault = await fromBase;
      // A same-named branch already on the remote is what a push would update, even without tracking configured.
      const published = `refs/remotes/${PRIMARY_REMOTE}/${branch}`;
      ahead = await refExists(root, published, signal) ? await count(root, `${published}..HEAD`, signal)
        : onDefault ? await aheadOfBase(root, branch, base, signal) : aheadOfDefault;
    }
  }
  return { ahead, behind, aheadOfDefault, defaultBranch: base, isDefaultBranch: onDefault, hasPrimaryRemote: remotes.includes(PRIMARY_REMOTE), provider: url ? detectSourceControl(url) : null };
}
