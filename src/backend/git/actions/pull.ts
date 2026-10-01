import { GitError } from "../../../contracts/git.js";
import { gitCommand, gitText } from "../command.js";

/** Fast-forwards the current branch from its upstream; never merges, rebases or stashes. */
export async function pullCurrentBranch(root: string, branch: string | null, upstream: string | null, signal: AbortSignal) {
  if (!branch) throw new GitError({ code: "INVALID", message: "Cannot pull from detached HEAD." });
  if (!upstream) throw new GitError({ code: "INVALID", message: "Current branch has no upstream configured. Push with upstream first." });
  const before = await gitText(root, ["rev-parse", "HEAD"], { signal });
  await gitCommand(root, ["pull", "--ff-only", "--no-rebase", "--no-autostash", "--recurse-submodules=no"], { signal, timeout: 5 * 60_000 });
  const after = await gitText(root, ["rev-parse", "HEAD"], { signal });
  return { updated: before !== after, branch, upstream };
}
