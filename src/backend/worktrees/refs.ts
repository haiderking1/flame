import { existsSync, realpathSync } from "node:fs";
import type { GitRef, GitRefList } from "../../contracts/worktrees.js";
import { gitText } from "../git/command.js";
import { defaultBranch } from "../git/branch-state.js";
import { currentBranch, isRepository, listWorktrees } from "./git-worktrees.js";

const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };
/**
 * Branches for the branch picker: the current one, then the default, then the rest by latest commit. Remote branches
 * that have a local branch of the same name are left out, and each branch notes the other worktree it is checked out in.
 */
export async function listRefs(cwd: string, query: string, limit: number, signal?: AbortSignal): Promise<GitRefList> {
  if (!await isRepository(cwd, signal)) return { repository: false, refs: [], total: 0, current: null, defaultBranch: null };
  const [top, current, base, worktrees, remotes, listing] = await Promise.all([
    gitText(cwd, ["rev-parse", "--show-toplevel"], { signal }), currentBranch(cwd, signal), defaultBranch(cwd, signal), listWorktrees(cwd, signal),
    gitText(cwd, ["remote"], { signal }).then(text => text.split("\n").filter(Boolean)),
    gitText(cwd, ["for-each-ref", "--sort=-committerdate", "--format=%(refname)", "refs/heads", "refs/remotes"], { signal }),
  ]);
  const here = real(top);
  const checkedOut = new Map(worktrees.filter(tree => tree.branch && !tree.prunable && existsSync(tree.path) && real(tree.path) !== here).map(tree => [tree.branch!, tree.path]));
  const names = listing.split("\n").filter(Boolean);
  const locals = names.filter(name => name.startsWith("refs/heads/")).map(name => name.slice("refs/heads/".length));
  const localSet = new Set(locals);
  const byLength = [...remotes].sort((a, b) => b.length - a.length);
  const refs: GitRef[] = locals.map(name => ({ name, remote: null, current: name === current, isDefault: name === base, worktreePath: checkedOut.get(name) ?? null }));
  for (const name of names.filter(name => name.startsWith("refs/remotes/"))) {
    const short = name.slice("refs/remotes/".length), remote = byLength.find(candidate => short.startsWith(`${candidate}/`));
    if (!remote) continue;
    const branch = short.slice(remote.length + 1);
    if (branch === "HEAD" || localSet.has(branch)) continue;
    refs.push({ name: short, remote, current: false, isDefault: remote === "origin" && branch === base, worktreePath: null });
  }
  const rank = (ref: GitRef) => ref.current ? 0 : ref.isDefault ? 1 : ref.remote === null ? 2 : 3;
  const needle = query.trim().toLowerCase();
  const matching = refs.map((ref, index) => ({ ref, index })).filter(({ ref }) => !needle || ref.name.toLowerCase().includes(needle))
    .sort((a, b) => rank(a.ref) - rank(b.ref) || a.index - b.index).map(({ ref }) => ref);
  return { repository: true, refs: matching.slice(0, limit), total: matching.length, current, defaultBranch: base };
}
