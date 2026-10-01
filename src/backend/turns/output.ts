import { InferenceFailure } from "./sse.js";
import { isFileTool } from "../file-tools/definitions.js";
import { MAX_ARGUMENT_BYTES } from "../file-tools/types.js";
import { isCollaborationTool } from "../agents/tools.js";
import { inferenceUsage, type InferenceUsage } from "./usage.js";

export type InferenceResult = { text: string; output: unknown[]; usage?: InferenceUsage };
export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const fail = (message: string): never => { throw new InferenceFailure(message); };
const limit = (value: unknown) => {
  if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024) fail("The response exceeded Flame's storage limit.");
};
function messageText(raw: unknown, tools = false): string {
  const item = object(raw);
  if (item.type === "reasoning") return "";
  if (tools && item.type === "function_call") {
    const file = isFileTool(String(item.name)), team = isCollaborationTool(String(item.name));
    if ((!file && !team && !["bash", "bash_job"].includes(String(item.name))) || typeof item.call_id !== "string" || !item.call_id || item.call_id.length > 256 || typeof item.arguments !== "string" || Buffer.byteLength(item.arguments) > (file || team ? MAX_ARGUMENT_BYTES : 64 * 1024)) return fail("OpenAI returned an invalid tool call.");
    return "";
  }
  if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) return fail("OpenAI returned an unsupported response item.");
  return item.content.map((rawPart) => {
    const part = object(rawPart);
    const text = part.type === "output_text" ? part.text : part.type === "refusal" ? part.refusal : undefined;
    if (typeof text !== "string") return fail("OpenAI returned an invalid response.");
    return text;
  }).join("");
}

// Codex can complete items individually and omit them from the terminal envelope.
// Keep those items (including opaque reasoning) until an explicit success event.
export class ResponseOutput {
  private items = new Map<number, Record<string, unknown>>();
  constructor(private readonly tools = false) {}
  record(index: unknown, raw: unknown) {
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0 || index >= 1000) return fail("OpenAI returned an invalid output index.");
    messageText(raw, this.tools);
    this.items.set(index, object(raw));
    limit([...this.items.values()]);
  }
  complete(value: unknown, streamedText: string): InferenceResult {
    const response = object(value);
    if (!value || typeof value !== "object" || Array.isArray(value) || (response.status !== undefined && response.status !== "completed")) return fail("OpenAI did not complete the response.");
    if (response.output !== undefined && !Array.isArray(response.output)) return fail("OpenAI returned an invalid response.");
    const terminal = (response.output ?? []) as unknown[];
    if (terminal.length > 1000) return fail("OpenAI returned too many response items.");
    terminal.forEach((raw, index) => {
      const item = object(raw);
      const existing = typeof item.id === "string" ? [...this.items].find(([, saved]) => saved.id === item.id) : undefined;
      let slot = existing?.[0] ?? index;
      const occupied = this.items.get(slot);
      if (!existing && occupied && typeof item.id === "string" && typeof occupied.id === "string" && occupied.id !== item.id) {
        slot = Math.max(...this.items.keys()) + 1;
      }
      this.record(slot, { ...(existing?.[1] ?? this.items.get(slot)), ...item });
    });
    const output: unknown[] = [...this.items].sort(([a], [b]) => a - b).map(([, item]) => item);
    let text = output.map(item => messageText(item, this.tools)).filter(Boolean).join("\n\n");
    if (!text.trim() && streamedText.trim()) {
      // Some success envelopes contain only metadata. Deltas are still real
      // provider text; success is established by the terminal event, not EOF.
      for (let i = output.length - 1; i >= 0; i--) if (object(output[i]).type === "message") output.splice(i, 1);
      output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: streamedText, annotations: [] }] });
      text = streamedText;
    }
    if (!text.trim() && !output.some(item => this.tools && object(item).type === "function_call")) return fail("OpenAI finished without an assistant message.");
    const ids = output.filter(item => object(item).type === "function_call").map(item => object(item).call_id);
    // Any number of tool calls is fine; only their IDs must be unique, since each result answers one call.
    if (new Set(ids).size !== ids.length) return fail("OpenAI returned duplicate tool call IDs.");
    if (Buffer.byteLength(text) > 1024 * 1024) return fail("The response exceeded Flame's storage limit.");
    limit(output);
    const usage = inferenceUsage(response.usage);
    return { text, output, ...(usage ? { usage } : {}) };
  }
}
