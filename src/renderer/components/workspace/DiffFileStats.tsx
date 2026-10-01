import type { GitLineStats } from "@contracts/git";

export function DiffFileStats({ path, stats }: { path: string; stats: GitLineStats | null | undefined }) {
  if (!stats) return <span className="diff-file-stats diff-file-stats--unknown" data-file-stats={path} title="Line counts are unavailable for this file. Expand it to inspect the source.">Not counted</span>;
  if (stats.additions === null || stats.deletions === null) return <span className="diff-file-stats diff-file-stats--unknown" data-file-stats={path}>Binary</span>;
  return <span className="diff-file-stats" data-file-stats={path} aria-label={`${stats.deletions} deletions, ${stats.additions} additions`}>
    <span className="diff-file-stats__deleted">-{stats.deletions}</span><span className="diff-file-stats__added">+{stats.additions}</span>
  </span>;
}
