import { createHash } from "node:crypto";

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const outputDigest = (output: unknown[]) => createHash("sha256").update(JSON.stringify(output)).digest("hex");
export function summaryInput(summary: string) {
  return { role: "user", content: [{ type: "input_text", text: `[Conversation checkpoint: a summary of earlier messages, not a new human request. Continue the existing task and respect the latest user instructions.]\n${summary}` }] };
}

// Provider reasoning is opaque and scoped to its originating account/model.
// Tool records become ordinary historical text when switching either scope;
// their call IDs must never create unresolved calls in a new provider context.
export function portableInput(items: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const value of items) {
    const item = object(value);
    if (item.type === "reasoning") continue;
    if (item.type === "function_call" || item.type === "function_call_output") {
      const historical = JSON.stringify(item, (key, current: unknown) => key === "encrypted_content" ? undefined : current);
      result.push({ role: "user", content: [{ type: "input_text", text: `[Historical tool record; not a new request. Do not replay this operation.]\n${historical}` }] });
    } else {
      const clean = JSON.parse(JSON.stringify(item, (key, current: unknown) => key === "encrypted_content" ? undefined : current)) as Record<string, unknown>;
      // IDs/phases from another model are response metadata, not user content.
      if (clean.type === "message") { delete clean.id; delete clean.phase; delete clean.status; }
      result.push(clean);
    }
  }
  return result;
}

export function assertCompleteTools(items: unknown[]) {
  const pending = new Set<string>(), seen = new Set<string>();
  for (const raw of items) {
    const item = object(raw);
    if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || !item.call_id || seen.has(item.call_id)) throw new Error("Invalid compacted tool call boundary.");
      pending.add(item.call_id); seen.add(item.call_id);
    } else if (item.type === "function_call_output") {
      if (typeof item.call_id !== "string" || !pending.delete(item.call_id)) throw new Error("Invalid compacted tool result boundary.");
    }
  }
  if (pending.size) throw new Error("Compaction cannot split an unfinished tool call.");
}
