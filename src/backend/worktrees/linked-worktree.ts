import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

const real = (path: string) => { try { return realpathSync(path); } catch { return null; } };
/** The repository metadata a checkout uses: its `.git` folder, or a linked worktree's folder under the common one. */
function metadata(checkout: string) {
  const git = join(checkout, ".git");
  try {
    if (lstatSync(git).isDirectory()) return { own: git, common: git };
    const pointer = readFileSync(git, "utf8").trim();
    if (!pointer.startsWith("gitdir: ")) return null;
    const own = resolve(checkout, pointer.slice(8).trim());
    let common = own;
    try { common = resolve(own, readFileSync(join(own, "commondir"), "utf8").trim()); } catch { /* A main checkout's metadata has no commondir. */ }
    return { own, common };
  } catch { return null; }
}
/**
 * The real path of `path` when it is the root of a linked worktree of the same repository as `project`, and is still
 * registered there (its metadata points back at it); otherwise null. Synchronous and spawns nothing.
 */
export function linkedWorktreeOf(project: string, path: string) {
  const root = real(path), repository = metadata(project), worktree = root ? metadata(root) : null;
  if (!root || !repository || !worktree || worktree.own === worktree.common) return null;
  if (real(worktree.common) !== real(repository.common)) return null;
  try { if (real(resolve(worktree.own, readFileSync(join(worktree.own, "gitdir"), "utf8").trim(), "..")) !== root) return null; } catch { return null; }
  return root;
}
