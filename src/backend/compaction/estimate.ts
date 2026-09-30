import { record } from "./types.js";

// Pi uses four text characters per token. Count non-ASCII code points separately
// rather than assuming that CJK/emoji have the same density as English prose.
export function estimateTextTokens(text: string): number {
  let ascii = 0, unicode = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 127) ascii++;
    else unicode += character.length;
  }
  return Math.ceil(ascii / 4) + unicode;
}

function contentTokens(value: unknown): number {
  if (typeof value === "string") return estimateTextTokens(value);
  if (!Array.isArray(value)) return 0;
  return value.reduce((total: number, raw: unknown) => {
    const part = record(raw);
    // Reserve visual tokens, never count the base64 bytes as prose. The estimate
    // is deliberately generous; actual provider usage supersedes this heuristic.
    if (part.type === "input_image") return total + (part.detail === "low" ? 1024 : 8192);
    return total + (typeof part.text === "string" ? estimateTextTokens(part.text)
      : typeof part.refusal === "string" ? estimateTextTokens(part.refusal) : 0);
  }, 0);
}

export function estimateTokens(input: readonly unknown[]): number {
  return input.reduce((total: number, raw: unknown) => {
    const item = record(raw);
    // Opaque encrypted reasoning is not decodable text. Its actual context use
    // belongs to provider accounting, rather than its encoded transport length.
    if (item.type === "reasoning") return total + 8 + contentTokens(item.summary);
    let tokens = 8 + contentTokens(item.content);
    if (typeof item.text === "string") tokens += estimateTextTokens(item.text);
    if (typeof item.name === "string") tokens += estimateTextTokens(item.name);
    if (typeof item.arguments === "string") tokens += estimateTextTokens(item.arguments);
    tokens += contentTokens(item.output);
    return total + tokens;
  }, 0);
}
