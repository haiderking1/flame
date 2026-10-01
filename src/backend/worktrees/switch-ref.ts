import { GitError } from "../../contracts/git.js";
import { gitCommand, gitText } from "../git/command.js";
import { localBranches } from "./git-worktrees.js";

const friendly = (error: unknown, ref: string) => {
  if (!(error instanceof GitError)) throw error;
  const used = /already (?:checked out|used by worktree) at '([^']+)'/.exec(error.message);
  if (used) throw new GitError({ code: "INVALID", message: `${ref} is already checked out in ${used[1]}. Pick that worktree instead.` });
  if (/would be overwritten|commit your changes or stash them/i.test(error.message))
    throw new GitError({ code: "INVALID", message: `Switching to ${ref} would overwrite uncommitted changes. Commit or stash them first.` });
  throw error;
};
/** Checks out `ref` in `cwd`, or creates it from HEAD; a remote branch gets a local tracking branch. Returns the branch now checked out. */
export async function switchRef(cwd: string, ref: string, create: boolean, signal?: AbortSignal) {
  if ((await gitCommand(cwd, ["check-ref-format", "--branch", ref], { signal, allowed: [0, 1, 128] })).code !== 0)
    throw new GitError({ code: "INVALID", message: `${ref} is not a valid branch name.` });
  const locals = await localBranches(cwd, signal);
  try {
    if (create) {
      if (locals.includes(ref)) throw new GitError({ code: "INVALID", message: `A branch named ${ref} already exists.` });
      await gitCommand(cwd, ["switch", "-c", ref], { signal, timeout: 120_000 });
      return ref;
    }
    if (locals.includes(ref)) { await gitCommand(cwd, ["switch", ref], { signal, timeout: 120_000 }); return ref; }
    const remotes = (await gitText(cwd, ["remote"], { signal })).split("\n").filter(Boolean).sort((a, b) => b.length - a.length);
    const remote = remotes.find(name => ref.startsWith(`${name}/`));
    if (!remote) throw new GitError({ code: "NOT_FOUND", message: `${ref} no longer exists. Refresh the branch list.` });
    const local = ref.slice(remote.length + 1);
    if (locals.includes(local)) { await gitCommand(cwd, ["switch", local], { signal, timeout: 120_000 }); return local; }
    await gitCommand(cwd, ["switch", "--track", ref], { signal, timeout: 120_000 });
    return local;
  } catch (error) { return friendly(error, ref); }
}
