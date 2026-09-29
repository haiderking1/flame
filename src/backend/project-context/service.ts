import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalPath, resolveContextPath } from "./paths.js";
import { loadDirectory } from "./read.js";
import { shadowedContextFile } from "./worktree.js";
import type { ContextWarning, ProjectInstruction } from "./types.js";

export async function loadProjectContextFiles({ cwd, agentDir = join(homedir(), ".flame", "agent"), signal,
  warn = message => console.warn(message) }: { cwd: string; agentDir?: string; signal: AbortSignal; warn?: ContextWarning }): Promise<ProjectInstruction[]> {
  const directory = resolveContextPath(cwd), globalDirectory = resolveContextPath(agentDir);
  const files: ProjectInstruction[] = [];
  const global = await loadDirectory(globalDirectory, signal, warn);
  if (global) files.push(global);
  const shadowed = await shadowedContextFile(directory, signal, warn);
  const ancestors: ProjectInstruction[] = [];
  for (let current = directory; ; current = dirname(current)) {
    signal.throwIfAborted();
    const file = await loadDirectory(current, signal, warn);
    if (file && file.path !== global?.path && (shadowed === undefined || await canonicalPath(file.path) !== shadowed)) ancestors.unshift(file);
    if (dirname(current) === current) break;
  }
  signal.throwIfAborted();
  return [...files, ...ancestors];
}
