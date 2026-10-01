const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** An agent's final answer: the last assistant message of its run that is not commentary, or all its text when there is none. */
export function finalAnswer(output: readonly unknown[], text: string) {
  for (let index = output.length - 1; index >= 0; index--) {
    const item = object(output[index]);
    if (item.type !== "message" || item.role !== "assistant" || item.phase === "commentary" || !Array.isArray(item.content)) continue;
    const answer = item.content.map(part => { const p = object(part); return p.type === "output_text" && typeof p.text === "string" ? p.text : ""; }).join("");
    if (answer.trim()) return answer;
  }
  return text;
}
