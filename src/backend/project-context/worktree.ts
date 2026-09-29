import { basename, dirname, join, sep } from "node:path";
import { findGitPaths } from "./git-paths.js";
import { canonicalPath } from "./paths.js";
import { loadDirectory } from "./read.js";
import type { ContextWarning } from "./types.js";

/** A nested linked worktree can supply its own copy of the main checkout's instructions. */
export async function shadowedContextFile(cwd: string, signal: AbortSignal, warn: ContextWarning): Promise<string | undefined> {
  const git = await findGitPaths(cwd, signal);
  if (!git) return;
  const common = await canonicalPath(git.commonDirectory);
  const worktree = await canonicalPath(git.repository);
  const main = dirname(common);
  if (!worktree.startsWith(`${main}${sep}`)) return;
  // Bare layouts and submodule metadata are not a containing main checkout.
  if (await canonicalPath(join(main, ".git")) !== common) return;
  const own = await loadDirectory(worktree, signal, warn);
  return own ? join(main, basename(own.path)) : undefined;
}
