import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { GitError, type GitStatus } from "../../contracts/git.js";
import { gitCommand } from "./command.js";

const STAT_CONCURRENCY = 16;
const invalidRaw = () => new GitError({ code: "COMMAND", message: "Git returned an invalid index listing." });
/** Maps each path whose staged blob differs from HEAD to that blob id (`git diff --cached --raw -z`). */
export function parseRawIndex(output: string): Map<string, string> {
  const records = output.split("\0"), result = new Map<string, string>();
  for (let i = 0; i < records.length; i++) {
    const meta = records[i]!; if (!meta) continue;
    const fields = meta.split(" "), path = records[++i];
    if (!meta.startsWith(":") || fields.length !== 5 || !/^[0-9a-f]{40,64}$/.test(fields[3]!) || !path) throw invalidRaw();
    result.set(path, fields[3]!);
  }
  return result;
}
// Any write (including atomic rename-over writes) changes size, mtime, ctime or inode, without reading file contents.
async function diskSignature(root: string, path: string) {
  const target = resolve(root, path);
  if (isAbsolute(path) || relative(root, target).split(sep).includes("..")) return "outside";
  try {
    const stat = await lstat(target, { bigint: true });
    return `${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "absent" : `unreadable:${code ?? "unknown"}`;
  }
}
/** Adds an opaque per-file `version` that changes whenever the staged blob or the on-disk file changes. */
export async function repositoryVersions(root: string, files: GitStatus["files"], signal?: AbortSignal): Promise<GitStatus["files"]> {
  if (!files.length) return files;
  const raw = await gitCommand(root, ["diff", "--cached", "--raw", "-z", "--no-renames", "--no-abbrev", "--ignore-submodules=all"], { signal, timeout: 10_000 });
  const staged = parseRawIndex(new TextDecoder("utf-8", { fatal: true }).decode(raw.stdout));
  const signatures = new Array<string>(files.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(STAT_CONCURRENCY, files.length) }, async () => {
    while (cursor < files.length) {
      if (signal?.aborted) throw new GitError({ code: "UNAVAILABLE", message: "Git status was interrupted." });
      const index = cursor++;
      signatures[index] = await diskSignature(root, files[index]!.path);
    }
  }));
  return files.map((file, index) => ({ ...file, version: createHash("sha256").update(staged.get(file.path) ?? "head").update("\0").update(signatures[index]!).digest("hex").slice(0, 32) }));
}
