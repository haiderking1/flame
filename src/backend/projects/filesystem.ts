import { opendir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { ProjectError, type BrowseResult } from "../../contracts/projects.js";

export function filesystemError(error: unknown): ProjectError {
  if (error instanceof ProjectError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") return new ProjectError({ code: "NOT_FOUND", message: "This folder no longer exists." });
  if (code === "EACCES" || code === "EPERM") return new ProjectError({ code: "PERMISSION", message: "You do not have permission to access this folder." });
  if (code === "ENOTDIR") return new ProjectError({ code: "NOT_DIRECTORY", message: "Choose a directory, not a file." });
  return new ProjectError({ code: "UNAVAILABLE", message: "The folder could not be read. Check the path and try again." });
}

export async function canonicalDirectory(input: string): Promise<string> {
  if (input.includes("\0") || input.length > 4096) throw new ProjectError({ code: "INVALID_PATH", message: "Invalid folder path." });
  const expanded = input === "~" || input === "~/" ? homedir() : input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
  if (!isAbsolute(expanded)) throw new ProjectError({ code: "INVALID_PATH", message: "Enter an absolute path or start with ~/." });
  const path = await realpath(normalize(expanded));
  if (!(await stat(path)).isDirectory()) throw new ProjectError({ code: "NOT_DIRECTORY", message: "Choose a directory, not a file." });
  return path;
}

export async function browseDirectory(input: string, signal?: AbortSignal): Promise<BrowseResult> {
  const path = await canonicalDirectory(input);
  const entries: Array<{ name: string; path: string }> = [];
  let truncated = false;
  const directory = await opendir(path);
  // Bound work and memory, including directories containing millions of files.
  let scanned = 0;
  for await (const entry of directory) {
    signal?.throwIfAborted();
    if (++scanned > 20_000 || entries.length >= 2_000) { truncated = true; break; }
    if (entry.name.startsWith(".")) continue;
    const child = join(path, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try { isDirectory = (await stat(child)).isDirectory(); } catch { continue; }
    }
    if (isDirectory) entries.push({ name: entry.name, path: child });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.name.localeCompare(b.name));
  const homePath = await realpath(homedir()).catch(() => homedir());
  return { path, homePath, parent: dirname(path) === path ? null : dirname(path), entries, truncated };
}
