import type { SessionLocation } from "../../contracts/sessions.js";
import type { BashRuntime } from "../bash/service.js";
import { bashTools } from "../bash/tools.js";
import type { FileTools } from "../file-tools/service.js";
import { fileTools } from "../file-tools/definitions.js";
import { loadProjectContextFiles } from "../project-context/service.js";
import { formatProjectContext } from "../project-context/format.js";
import { estimateTextTokens } from "../compaction/estimate.js";
import { agentInstructions } from "./instructions.js";

export async function agentContext(location: SessionLocation, runtime: BashRuntime | undefined,
  files: FileTools | undefined, signal: AbortSignal, team?: { tools: unknown[]; instructions: string }) {
  const cwd = files?.workingDirectory(location) ?? runtime?.workingDirectory(location);
  const projectInstructions = cwd ? formatProjectContext(await loadProjectContextFiles({ cwd, signal })) : undefined;
  const tools = !!runtime || !!files || !!team;
  const overhead = estimateTextTokens(JSON.stringify({ instructions: agentInstructions(tools, !!files, cwd, projectInstructions) + (team ? `\n\n${team.instructions}` : ""),
    tools: [...(runtime ? bashTools : []), ...(files ? fileTools : []), ...(team?.tools ?? [])] }));
  return { cwd, projectInstructions, tools, fileTools: !!files, bashTools: !!runtime, overhead };
}
