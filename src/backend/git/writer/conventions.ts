import { lstat, readFile, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { gitCommand } from "../command.js";

const MAX_AGENTS_BYTES = 20 * 1024;
async function agentsFile(root: string) {
  try {
    const path = join(root, "AGENTS.md"), info = await lstat(path);
    if (!info.isFile() || info.size > MAX_AGENTS_BYTES) return null;
    const resolved = await realpath(path), inside = relative(root, resolved);
    if (inside.startsWith("..") || isAbsolute(inside)) return null;
    return (await readFile(resolved, "utf8")).trim() || null;
  } catch { return null; }
}
/** The repository's own style: recent commit subjects and its AGENTS.md, so generated text follows local conventions. */
export async function repositoryConventions(root: string, kind: "commit" | "change request", signal?: AbortSignal) {
  const log = await gitCommand(root, ["log", "-n", "20", "--no-merges", "--pretty=format:%s"], { signal, allowed: [0, 128], maxBytes: 64 * 1024 });
  const subjects = log.code === 0 ? log.stdout.toString("utf8").trim() : "";
  const agents = await agentsFile(root);
  return [
    kind === "commit" ? "Follow the repository's established commit message style when examples are available."
      : "Follow the repository's established change request title and body style when examples are available.",
    ...(subjects ? ["", "Recent commit subjects from this repository:", subjects] : []),
    ...(agents ? ["", "Local AGENTS.md:", agents] : []),
  ].join("\n");
}
