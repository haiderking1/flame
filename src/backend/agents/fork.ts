const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (item: Record<string, unknown>) => Array.isArray(item.content)
  ? item.content.map(part => { const p = object(part); return typeof p.text === "string" ? p.text : ""; }).join("") : "";
// Notices Flame adds as user input are not turns the person started: tool records, job notifications and agent mail.
const isNotice = (item: Record<string, unknown>) => text(item).startsWith("[") && !text(item).startsWith("[Conversation checkpoint");

/**
 * The part of a conversation a new agent inherits: the user's messages and the final answers, with the conversation
 * summaries compaction left; never reasoning, tool calls and their results, or commentary. `turns` keeps only that
 * many of the most recent user turns.
 */
export function forkConversation(input: readonly unknown[], turns: "all" | "none" | number): unknown[] {
  if (turns === "none") return [];
  const kept: Record<string, unknown>[] = [];
  for (const raw of input) {
    const item = object(raw);
    if (item.role === "user" && Array.isArray(item.content) && !text(item).startsWith("[Historical tool")) kept.push({ role: "user", content: item.content });
    else if ((item.type === "message" || item.type === undefined) && item.role === "assistant" && item.phase !== "commentary") {
      const answer = text(item);
      if (answer.trim()) kept.push({ role: "assistant", content: [{ type: "output_text", text: answer }] });
    }
  }
  if (turns === "all") return kept;
  const starts = kept.flatMap((item, index) => item.role === "user" && !isNotice(item) ? [index] : []);
  return starts.length > turns ? kept.slice(starts[starts.length - turns]) : kept;
}
