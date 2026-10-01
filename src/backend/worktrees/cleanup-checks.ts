import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { detectSourceControl } from "../../contracts/source-control.js";
import { gitCommand, gitText } from "../git/command.js";
import { defaultBranch, hostingRemoteUrl } from "../git/branch-state.js";
import { headContext } from "../git/head-context.js";
import { hostingFor } from "../git/hosting/index.js";
import { currentBranch } from "./git-worktrees.js";

const FETCH_TIMEOUT_MS = 60_000;
const real = (path: string) => { try { return realpathSync(path); } catch { return null; } };
const inside = (parent: string, child: string) => { const path = relative(parent, child); return !!path && !path.startsWith("..") && !isAbsolute(path); };

/**
 * Whether a worktree can be removed without losing anything, as T3 Code's storage cleanup checks: it is a linked worktree
 * Flame created, holds no project, is still on the branch its session recorded, has no changes, and ignores nothing but
 * dependency folders (ignored files such as `.env` may be secrets or data that exist nowhere else).
 */
export async function safeToRemove(path: string, branch: string, directory: string, projects: readonly string[], signal?: AbortSignal) {
  const base = real(directory), resolved = real(path);
  if (!base || !resolved || resolved !== path || !inside(base, resolved)) return false;
  if (projects.some(project => { const root = real(project); return root !== null && (root === resolved || inside(resolved, root)); })) return false;
  try { if (!lstatSync(join(resolved, ".git")).isFile()) return false; } catch { return false; }
  if (await currentBranch(resolved, signal) !== branch) return false;
  const status = await gitCommand(resolved, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { signal, allowed: [0, 128] });
  if (status.code !== 0 || status.stdout.length) return false;
  const ignored = (await gitText(resolved, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"], { signal })).split("\0").filter(Boolean);
  return ignored.every(entry => entry === "node_modules/" || /(^|\/)node_modules\/$/.test(entry));
}
/** Whether every commit on the worktree's HEAD is already on the default branch at origin, after fetching it. */
export async function mergedIntoDefault(path: string, signal?: AbortSignal) {
  const base = await defaultBranch(path, signal);
  if (!base) return false;
  await gitCommand(path, ["fetch", "--quiet", "--no-tags", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`], { signal, timeout: FETCH_TIMEOUT_MS, allowed: [0, 1, 128] });
  return (await gitCommand(path, ["merge-base", "--is-ancestor", "HEAD", `refs/remotes/origin/${base}`], { signal, allowed: [0, 1, 128] })).code === 0;
}
/** Whether the branch's latest change request on the hosting provider was merged. */
export async function changeRequestMerged(path: string, branch: string, signal?: AbortSignal) {
  const url = await hostingRemoteUrl(path, branch, signal);
  const hosting = hostingFor(url ? detectSourceControl(url)?.kind : null);
  if (!hosting) return false;
  const upstream = await gitCommand(path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { signal, allowed: [0, 128] });
  const head = await headContext(path, branch, upstream.code === 0 ? upstream.stdout.toString("utf8").trim() : null, signal);
  return (await hosting.changeRequests(path, head, "all", signal))[0]?.state === "merged";
}
export const folderExists = (path: string) => existsSync(path);
