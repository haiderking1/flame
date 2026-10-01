import { lstat, open, readlink, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { GitError } from "../../contracts/git.js";

export const MAX_FILE = 4 * 1024 * 1024;
export async function diskFile(root: string, path: string, missingAsEmpty = true): Promise<Buffer> {
  const target = resolve(root, path);
  if (isAbsolute(path) || relative(root, target).split(sep).includes("..")) throw new GitError({ code: "INVALID", message: "File path is outside the repository." });
  try {
    if ((await lstat(target)).isSymbolicLink()) return await readlink(target, { encoding: "buffer" });
    const canonical = await realpath(target);
    if (relative(root, canonical).split(sep).includes("..")) throw new GitError({ code: "INVALID", message: "This file links outside the repository." });
    const handle = await open(canonical, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_FILE) throw new GitError({ code: "INVALID", message: "Only regular files up to 4 MiB can be previewed. Use your editor for this file." });
      const bytes = Buffer.alloc(Math.min(MAX_FILE + 1, stat.size + 1));
      let offset = 0;
      while (offset < bytes.length) { const result = await handle.read(bytes, offset, bytes.length - offset, offset); if (!result.bytesRead) break; offset += result.bytesRead; }
      if (offset > MAX_FILE || offset > stat.size) throw new GitError({ code: "INVALID", message: "File changed while being read. Refresh to retry." });
      return bytes.subarray(0, offset);
    } finally { await handle.close(); }
  } catch (error) { if (missingAsEmpty && (error as NodeJS.ErrnoException).code === "ENOENT") return Buffer.alloc(0); throw error; }
}
