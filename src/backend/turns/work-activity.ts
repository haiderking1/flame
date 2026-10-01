import type { WorkActivity, WorkStep } from "../../contracts/work.js";
import { fileWork } from "./file-work.js";
import { agentWork } from "./agent-work.js";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const parse = (value: unknown): Record<string, unknown> => { try { return object(JSON.parse(String(value))); } catch { return {}; } };
const message = (item: Record<string, unknown>) => item.type === "message" && item.role === "assistant" && Array.isArray(item.content)
  ? item.content.map(part => { const p = object(part); return p.type === "output_text" && typeof p.text === "string" ? p.text : p.type === "refusal" && typeof p.refusal === "string" ? p.refusal : ""; }).join("") : "";

// A public presentation projection, never the provider payload. In particular,
// reasoning, encrypted content, tool result envelopes and account data stay private.
export function workActivity(id: string, text: string, output: unknown[], status: string, startedAt: number, finishedAt: number | null): WorkActivity | undefined {
  const items = output.map(object);
  const lastTool = items.findLastIndex(item => item.type === "function_call");
  if (lastTool < 0) return undefined;
  const lastWork = items.findLastIndex(item => item.type === "function_call" || item.type === "function_call_output" || item.role === "user");
  const results = new Map(items.filter(item => item.type === "function_call_output").map(item => [item.call_id, parse(item.output)]));
  const steps: WorkStep[] = [], answers: string[] = [], allText: string[] = [];
  items.forEach((item, index) => {
    const content = message(item);
    if (content) {
      allText.push(content);
      if (status === "completed" && index > lastWork && item.phase !== "commentary") answers.push(content);
      else steps.push({ kind: "message", id: `message-${index}`, text: content });
    }
    if (item.type === "function_call" && typeof item.call_id === "string") {
      const args = parse(item.arguments), result = results.get(item.call_id);
      const file = fileWork(String(item.name), args, result, status), team = agentWork(String(item.name), args, result);
      steps.push({ kind: "tool", id: `tool-${item.call_id}`, callId: item.call_id, name: String(item.name),
        command: file?.command ?? team?.command ?? (typeof args.command === "string" ? args.command : args.action === "stop" ? "Stop background job" : "Check background job"),
        ...(file ? { file: file.file } : {}), ...(team ? { agent: team.agent } : {}),
        ...(result?.status === "deferred" && typeof result.summary === "string" ? { deferred: result.summary } : {}),
        jobId: typeof result?.job_id === "string" ? result.job_id : null,
        error: typeof result?.error === "string" ? result.error : typeof result?.message === "string" ? result.message
          : result?.status === "exited" && result.exit_code !== 0 ? `Command exited with ${result.signal ?? result.exit_code ?? "an unknown status"}.` : null });
    }
  });
  const savedText = allText.join("\n\n");
  // Paragraph checkpoints can run ahead of completed provider items. Show that
  // narration inside the live work group without duplicating committed messages.
  const tail = text.startsWith(savedText) ? text.slice(savedText.length).replace(/^\n\n/, "") : "";
  if (tail) steps.push({ kind: "message", id: "streaming-message", text: tail });
  return { turnId: id, startedAt, finishedAt, steps, answer: answers.join("\n\n") };
}
