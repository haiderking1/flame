import { record, type SummaryContent, type SummaryImage } from "./types.js";

function truncated(text: string): string {
  if (text.length <= 2000) return text;
  // Do not leave an unpaired UTF-16 surrogate at the boundary.
  const end = /[\uD800-\uDBFF]/.test(text[1999]) ? 1999 : 2000;
  return `${text.slice(0, end)}\n[${text.length - end} further characters omitted from this tool result]`;
}

export function serializeForSummary(prefix: readonly unknown[]): SummaryContent {
  const content: SummaryContent = [];
  const read = new Set<string>(), modified = new Set<string>();
  const text = (label: string, value: string) => { content.push({ type: "input_text", text: `[${label}]\n${value}` }); };
  for (const raw of prefix) {
    const item = record(raw);
    if (item.type === "reasoning") continue;
    if (item.type === "function_call") {
      text("Assistant tool call", `${String(item.name ?? "unknown")}(${String(item.arguments ?? "")})`);
      if (typeof item.arguments === "string") {
        try {
          const args = record(JSON.parse(item.arguments));
          if (typeof args.path === "string") {
            if (item.name === "read") read.add(args.path);
            if (item.name === "write" || item.name === "edit") modified.add(args.path);
          }
        } catch { /* Invalid arguments are still preserved verbatim in the record. */ }
      }
      continue;
    }
    const toolResult = item.type === "function_call_output";
    const parts = toolResult ? item.output : item.content;
    const label = toolResult ? "Tool result" : item.role === "assistant" ? "Assistant" : item.role === "user" ? "User" : "Conversation record";
    if (typeof parts === "string") { text(label, toolResult ? truncated(parts) : parts); continue; }
    if (Array.isArray(parts)) {
      for (const rawPart of parts) {
        const part = record(rawPart);
        if (typeof part.text === "string") text(label, toolResult ? truncated(part.text) : part.text);
        else if (typeof part.refusal === "string") text(label, part.refusal);
        else if (part.type === "input_image" && typeof part.image_url === "string") {
          text(label, toolResult ? "An image returned by this tool follows." : "An image attached to this conversation message follows.");
          const image: SummaryImage = { type: "input_image", image_url: part.image_url };
          if (part.detail === "auto" || part.detail === "low" || part.detail === "high") image.detail = part.detail;
          content.push(image);
        }
      }
    }
  }
  if (read.size || modified.size) text("File-operation records", JSON.stringify({
    readFiles: [...read].filter(path => !modified.has(path)).sort(), modifiedFiles: [...modified].sort(),
  }));
  return content;
}
