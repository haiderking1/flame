import type { GitLineStats, GitStatus } from "@contracts/git";
type File = GitStatus["files"][number];
function sameStats(a: GitLineStats | null | undefined, b: GitLineStats | null | undefined) {
  return a === b || (!!a && !!b && a.additions === b.additions && a.deletions === b.deletions) || (a == null && b == null);
}
export function sameGitFile(a: File | undefined, b: File | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.path === b.path && a.originalPath === b.originalPath && a.index === b.index && a.worktree === b.worktree
    && a.version === b.version && sameStats(a.stagedStats, b.stagedStats) && sameStats(a.workingStats, b.workingStats);
}
// Structural equality lets an unchanged background check keep the previous object, so nothing downstream re-renders or re-reads.
export function sameGitStatus(a: GitStatus | null, b: GitStatus | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.projectId !== b.projectId || a.repository !== b.repository || a.root !== b.root || a.branch !== b.branch || a.upstream !== b.upstream) return false;
  if (a.ahead !== b.ahead || a.behind !== b.behind || a.aheadOfDefault !== b.aheadOfDefault || a.defaultBranch !== b.defaultBranch || a.isDefaultBranch !== b.isDefaultBranch || a.hasPrimaryRemote !== b.hasPrimaryRemote) return false;
  if (JSON.stringify(a.provider) !== JSON.stringify(b.provider) || JSON.stringify(a.pr) !== JSON.stringify(b.pr)) return false;
  if (a.remotes.length !== b.remotes.length || a.remotes.some((remote, i) => remote !== b.remotes[i])) return false;
  return a.files.length === b.files.length && a.files.every((file, i) => sameGitFile(file, b.files[i]));
}
