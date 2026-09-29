import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exists } from "./paths.js";

type GitPaths = { repository: string; commonDirectory: string };

/** Inspect only the direct ancestor chain; no shell or repository enumeration. */
export async function findGitPaths(cwd: string, signal: AbortSignal): Promise<GitPaths | null> {
  for (let directory = cwd; ; directory = dirname(directory)) {
    signal.throwIfAborted();
    const git = join(directory, ".git");
    if (await exists(git)) {
      try {
        const info = await stat(git);
        if (info.isFile()) {
          const contents = (await readFile(git, { encoding: "utf8", signal })).trim();
          if (contents.startsWith("gitdir: ")) {
            const metadata = resolve(directory, contents.slice(8).trim());
            if (!await exists(join(metadata, "HEAD"))) return null;
            const commonFile = join(metadata, "commondir");
            const commonDirectory = await exists(commonFile)
              ? resolve(metadata, (await readFile(commonFile, { encoding: "utf8", signal })).trim()) : metadata;
            return { repository: directory, commonDirectory };
          }
        } else if (info.isDirectory()) {
          return await exists(join(git, "HEAD")) ? { repository: directory, commonDirectory: git } : null;
        }
      } catch { signal.throwIfAborted(); return null; }
    }
    if (dirname(directory) === directory) return null;
  }
}
