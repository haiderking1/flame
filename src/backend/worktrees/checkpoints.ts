import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { GitError } from "../../contracts/git.js";
import { gitCommand, gitText } from "../git/command.js";

/** Where a session's file checkpoint for one response is kept: a ref outside branches and tags, so Git never shows it. */
export const checkpointRef = (sessionId: string, turnId: string) => `refs/flame/checkpoints/${sessionId}/${turnId}`;
const IDENTITY = { GIT_AUTHOR_NAME: "Flame", GIT_AUTHOR_EMAIL: "flame@users.noreply.github.com", GIT_COMMITTER_NAME: "Flame", GIT_COMMITTER_EMAIL: "flame@users.noreply.github.com" };
const hasHead = async (cwd: string, signal?: AbortSignal) => (await gitCommand(cwd, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { signal, allowed: [0, 1, 128] })).code === 0;
/**
 * Saves the worktree's files, tracked and untracked but not ignored, as a commit under `ref`, as T3 Code's checkpoints do.
 * A private copy of the index is used, so the user's staging area and branch are untouched.
 */
export async function captureCheckpoint(cwd: string, ref: string, signal?: AbortSignal) {
  const common = await gitText(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"], { signal });
  const index = join(isAbsolute(common) ? common : resolve(cwd, common), `flame-checkpoint-index-${randomUUID()}`);
  const env = { ...IDENTITY, GIT_INDEX_FILE: index };
  const config = [["core.fsmonitor", "false"]] as const;
  try {
    // Starting from the real index keeps Git's file stat cache, so unchanged files are not read again.
    try { copyFileSync(await gitText(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "index"], { signal }), index); } catch { /* A fresh index works too. */ }
    await gitCommand(cwd, ["add", "--all", "--", "."], { signal, env, config, timeout: 300_000 });
    const tree = await gitText(cwd, ["write-tree"], { signal, env, config });
    const parent = await hasHead(cwd, signal) ? ["-p", "HEAD"] : [];
    const commit = await gitText(cwd, ["commit-tree", tree, ...parent, "-m", "Flame checkpoint"], { signal, env, config });
    await gitCommand(cwd, ["update-ref", ref, commit], { signal });
    return commit;
  } finally { rmSync(index, { force: true }); rmSync(`${index}.lock`, { force: true }); }
}
export async function hasCheckpoint(cwd: string, ref: string, signal?: AbortSignal) {
  return (await gitCommand(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { signal, allowed: [0, 1, 128] })).code === 0;
}
/**
 * Puts the worktree's files back as they were in the checkpoint: changed and deleted files are restored and files added
 * since are removed (ignored files are left alone). The branch and its commits stay as they are, as in T3 Code.
 */
export async function restoreCheckpoint(cwd: string, ref: string, signal?: AbortSignal) {
  if (!await hasCheckpoint(cwd, ref, signal)) throw new GitError({ code: "NOT_FOUND", message: "The files from before this message were not saved, so they cannot be restored." });
  const commit = await gitText(cwd, ["rev-parse", `${ref}^{commit}`], { signal });
  const tracked = await gitCommand(cwd, ["ls-files", "--cached", `--with-tree=${commit}`, "-z", "--", "."], { signal });
  if (tracked.stdout.length) await gitCommand(cwd, ["restore", "--source", commit, "--worktree", "--staged", "--", "."], { signal, timeout: 300_000 });
  // Restoring away the last tracked file can remove the folder itself.
  mkdirSync(cwd, { recursive: true });
  await gitCommand(cwd, ["clean", "-fd", "--", "."], { signal, timeout: 300_000 });
  if (await hasHead(cwd, signal)) await gitCommand(cwd, ["reset", "--quiet", "--", "."], { signal });
}
/** Every checkpoint of a session, such as when the session is deleted. */
export async function sessionCheckpoints(cwd: string, sessionId: string, signal?: AbortSignal) {
  return (await gitText(cwd, ["for-each-ref", "--format=%(refname)", `refs/flame/checkpoints/${sessionId}/`], { signal })).split("\n").filter(Boolean);
}
export async function deleteCheckpoints(cwd: string, refs: readonly string[], signal?: AbortSignal) {
  for (const ref of refs) await gitCommand(cwd, ["update-ref", "-d", ref], { signal, allowed: [0, 1] }).catch(() => {});
}
