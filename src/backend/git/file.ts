import { createHash } from "node:crypto";
import { GitError, type GitFileView } from "../../contracts/git.js";
import { gitCommand } from "./command.js";
import { repositoryListing } from "./status.js";
import { diskFile, MAX_FILE } from "./disk-file.js";
function decode(buffer: Buffer) { try { return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer), binary: buffer.includes(0) }; } catch { return { text: "", binary: true }; } }
async function gitFile(root: string, ref: string, path: string, signal?: AbortSignal) {
  // Check existence separately: show errors must not silently look like empty files.
  const object = ref ? `${ref}:${path}` : `:0:${path}`;
  const exists = await gitCommand(root, ["cat-file", "-e", object], { signal, allowed: [0, 1, 128] });
  if (exists.code !== 0) return Buffer.alloc(0);
  return (await gitCommand(root, ["show", object], { signal, maxBytes: MAX_FILE })).stdout;
}
export async function readGitFile(cwd: string, path: string, mode: "working" | "staged", signal?: AbortSignal): Promise<GitFileView> {
  if (path.includes("\0")) throw new GitError({ code: "INVALID", message: "This file path cannot be previewed." });
  const status = await repositoryListing(cwd, signal);
  const file = status.repository ? status.files.find(file => file.path === path) : undefined;
  if (!file || !status.repository) throw new GitError({ code: "NOT_FOUND", message: "This file is no longer in the change list. Refresh the panel." });
  const beforePath = mode === "staged" ? file.originalPath ?? path : file.originalPath && /[RC]/.test(file.worktree) ? file.originalPath : path;
  const [before, after] = mode === "staged" ? await Promise.all([gitFile(status.root, "HEAD", beforePath, signal), gitFile(status.root, "", path, signal)])
    : await Promise.all([gitFile(status.root, "", beforePath, signal), diskFile(status.root, path)]);
  const old = decode(before), current = decode(after);
  return { path, beforePath, before: old.text, after: current.text, binary: old.binary || current.binary, mode,
    version: createHash("sha256").update(before).update("\0").update(after).digest("hex") };
}
