import type { SessionLocation } from "../../contracts/sessions.js";
import type { BashRuntime } from "../bash/service.js";
import type { FileTools } from "../file-tools/service.js";
import { isFileTool } from "../file-tools/definitions.js";
import { calls, executeCall, jobResult } from "../bash/tools.js";
import { InferenceFailure, type CodexInferenceClient, type InferenceRequest } from "./client.js";
import type { CompactionRuntime } from "../compaction/runtime.js";
import { agentContext } from "./agent-context.js";
export function notificationInput(jobs: Parameters<typeof jobResult>[0][]) {
  return { role: "user", content: [{ type: "input_text", text: `[Automatic Bash completion notification, not a new human request]\n${JSON.stringify(jobs.map(jobResult))}\nContinue the existing task if needed. Do not rerun completed commands.` }] };
}
export async function agentLoop(client: Pick<CodexInferenceClient, "run">, request: InferenceRequest,
  runtime: BashRuntime | undefined, location: SessionLocation, turnId: string, account: string, signal: AbortSignal,
  onText: (text: string) => void, checkpoint: (text: string, output: unknown[]) => void, initialOutput: unknown[] = [], files?: FileTools, context?: CompactionRuntime) {
  let text = "";
  const output = [...initialOutput];
  const input = [...request.input];
  const seen = new Set<string>();
  const prepared = await agentContext(location, runtime, files, signal);
  context?.setOverhead(prepared.overhead);
  for (let step = 0; step < 32; step++) {
    signal.throwIfAborted();
    const prefix = text ? `${text}\n\n` : "";
    let streamed = prefix;
    const cwd = files?.workingDirectory(location.projectId) ?? runtime?.workingDirectory(location.projectId);
    if (cwd !== prepared.cwd) throw new InferenceFailure("The project's working directory changed during this turn. No further tools were executed.");
    const current = { ...request, ...prepared, input: [...input] };
    const stream = (delta: string) => {
      streamed += delta;
      if (Buffer.byteLength(streamed) > 1024 * 1024) throw new InferenceFailure("The agent response exceeded 1 MiB.");
      onText(streamed);
    };
    const response = context ? await context.run(current, stream) : await client.run(current, stream, signal);
    signal.throwIfAborted();
    text = response.text ? prefix + response.text : text;
    onText(text);
    output.push(...response.output); input.push(...response.output);
    context?.completed(response);
    checkpoint(text, output);
    const tools = calls(response.output);
    if (tools.length && !runtime && !files) throw new InferenceFailure("Tools are not available in this session.");
    for (const tool of tools) {
      signal.throwIfAborted();
      if (seen.has(tool.call_id)) throw new InferenceFailure("The provider repeated a tool call identifier. Nothing was replayed.");
      seen.add(tool.call_id);
      const result = isFileTool(tool.name)
        ? files ? await files.execute(location, turnId, tool, signal, request.supportsImages !== false) : { error: "File tools are not available in this session." }
        : runtime ? await executeCall(runtime, location, turnId, account, tool, signal) : { error: "Bash is not available in this session." };
      const item = { type: "function_call_output", call_id: tool.call_id, output: JSON.stringify(result) };
      output.push(item); checkpoint(text, output);
      const modelItem = { ...item, output: isFileTool(tool.name) && files ? files.modelOutput(location, item.output) : item.output };
      input.push(modelItem); context?.append([modelItem]);
    }
    const pending = runtime?.pending(location, account) ?? [];
    if (pending.length) {
      const notice = notificationInput(pending);
      output.push(notice); input.push(notice);
      context?.append([notice]);
      checkpoint(text, output);
      runtime!.acknowledge(location, pending.map(job => job.id));
    }
    if (!tools.length && !pending.length) return { text, output };
  }
  throw new InferenceFailure("The agent reached its 32-step limit. No operations will be replayed. Inspect files and jobs before continuing.");
}
