import { realpath } from "node:fs/promises";
import { GitError, type GitStatus } from "../../contracts/git.js";
import { gitCommand } from "./command.js";
import { repositoryStats } from "./stats.js";
import { repositoryVersions } from "./versions.js";
import { branchState } from "./branch-state.js";

export function parseStatus(output: string): GitStatus["files"] {
  const records = output.split("\0"), files: Array<GitStatus["files"][number]> = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!; if (!record) continue;
    if (record.length < 4 || record[2] !== " ") throw new GitError({ code: "COMMAND", message: "Git returned an invalid status listing." });
    const index = record[0]!, worktree = record[1]!, path = record.slice(3);
    const renamed = /[RC]/.test(index + worktree);
    const originalPath = renamed ? records[++i] : null;
    if (!path || renamed && !originalPath) throw new GitError({ code: "COMMAND", message: "Git returned an incomplete rename record." });
    files.push({ path, index, worktree, originalPath: originalPath ?? null });
  }
  return files;
}
async function detailedFiles(root: string, files: GitStatus["files"], signal?: AbortSignal) {
  const [stats, versions] = await Promise.all([repositoryStats(root, files, signal), repositoryVersions(root, files, signal)]);
  return stats.map((file, index) => ({ ...file, version: versions[index]!.version }));
}
type Listing = { repository: false } | { repository: true; root: string; branch: string | null; upstream: string | null; remotes: string[]; files: GitStatus["files"] };
/** Repository root, branch, upstream, remotes and changed files; null branch means detached HEAD. */
export async function repositoryListing(cwd: string, signal?: AbortSignal): Promise<Listing> {
  const probe = await gitCommand(cwd, ["rev-parse", "--show-toplevel"], { signal, allowed: [0, 128] });
  if (probe.code !== 0) {
    if (!probe.stderr.includes("not a git repository")) throw new GitError({ code: "COMMAND", message: probe.stderr });
    return { repository: false };
  }
  const root = await realpath(probe.stdout.toString("utf8").replace(/\r?\n$/, ""));
  const [status, branch, upstream, remotes] = await Promise.all([
    gitCommand(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { signal }),
    gitCommand(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { signal, allowed: [0, 1] }),
    gitCommand(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { signal, allowed: [0, 128] }),
    gitCommand(root, ["remote"], { signal }),
  ]);
  return { repository: true, root, branch: branch.code === 0 ? branch.stdout.toString("utf8").replace(/\r?\n$/, "") : null,
    upstream: upstream.code === 0 ? upstream.stdout.toString("utf8").replace(/\r?\n$/, "") : null,
    remotes: remotes.stdout.toString("utf8").replace(/\r?\n$/, "").split("\n").filter(Boolean),
    files: parseStatus(new TextDecoder("utf-8", { fatal: true }).decode(status.stdout)) };
}
const NOT_A_REPOSITORY = { repository: false, root: null, branch: null, upstream: null, remotes: [], files: [], ahead: 0, behind: 0, aheadOfDefault: 0,
  defaultBranch: null, isDefaultBranch: false, hasPrimaryRemote: false, provider: null, pr: null } as const;
/** Full status: the listing plus ahead/behind and hosting details. Change requests are attached by the caller from its cache. */
export async function repositoryStatus(projectId: string, cwd: string, signal?: AbortSignal, detailed = false): Promise<GitStatus> {
  const listing = await repositoryListing(cwd, signal);
  if (!listing.repository) return { ...NOT_A_REPOSITORY, projectId };
  const [files, branch] = await Promise.all([detailed ? detailedFiles(listing.root, listing.files, signal) : listing.files,
    branchState(listing.root, listing.branch, listing.upstream, listing.remotes, signal)]);
  return { projectId, ...listing, files, ...branch, pr: null };
}
