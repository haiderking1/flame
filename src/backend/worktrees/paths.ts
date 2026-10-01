import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** Flame keeps session worktrees outside projects, as T3 Code does: `~/.flame/worktrees/<repository>/<branch>`. */
export const defaultWorktreesDirectory = () => join(homedir(), ".flame", "worktrees");
/** A free folder for a worktree of `repository` on `branch`; slashes in the branch become dashes. */
export function worktreeFolder(base: string, repository: string, branch: string) {
  const preferred = join(base, basename(repository), branch.replace(/\//g, "-"));
  if (!existsSync(preferred)) return preferred;
  for (let suffix = 2; ; suffix++) if (!existsSync(`${preferred}-${suffix}`)) return `${preferred}-${suffix}`;
}
