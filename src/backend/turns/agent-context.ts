import type { SessionLocation } from "../../contracts/sessions.js";
import type { BashRuntime } from "../bash/service.js";
import type { FileTools } from "../file-tools/service.js";
import { loadProjectContextFiles } from "../project-context/service.js";
import { formatProjectContext } from "../project-context/format.js";

export async function agentContext(location: SessionLocation, runtime: BashRuntime | undefined,
  files: FileTools | undefined, signal: AbortSignal) {
  const cwd = files?.workingDirectory(location.projectId) ?? runtime?.workingDirectory(location.projectId);
  const projectInstructions = cwd ? formatProjectContext(await loadProjectContextFiles({ cwd, signal })) : undefined;
  const tools = !!runtime || !!files;
  return { cwd, projectInstructions, tools, fileTools: !!files, bashTools: !!runtime };
}
