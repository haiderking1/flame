import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "./paths.js";
import { INSTRUCTION_NAMES, type ContextWarning, type ProjectInstruction } from "./types.js";

export async function loadDirectory(directory: string, signal: AbortSignal, warn: ContextWarning): Promise<ProjectInstruction | null> {
  for (const name of INSTRUCTION_NAMES) {
    signal.throwIfAborted();
    const path = join(directory, name);
    if (!await exists(path)) continue;
    try {
      if (!(await stat(path)).isFile()) continue;
      const content = await readFile(path, { encoding: "utf8", signal });
      return { path, content: content.replace(/^\uFEFF/, "") };
    } catch (error) {
      signal.throwIfAborted();
      warn(`Could not read instructions at ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return null;
}
