export { basename, findFileMentions, serializeFileMention, type FileMention } from "@contracts/file-mentions";

export type MentionTrigger = { query: string; start: number; end: number };
const isWhitespace = (character: string) => character === " " || character === "\n" || character === "\t" || character === "\r";
/**
 * The `@query` token ending at the cursor. It starts at the beginning of the text or after whitespace and
 * runs to the cursor, so `name@host` never opens the file menu.
 */
export function detectMentionTrigger(text: string, cursor: number): MentionTrigger | null {
  const end = Math.max(0, Math.min(text.length, Math.floor(Number.isFinite(cursor) ? cursor : text.length)));
  let start = end;
  while (start > 0 && !isWhitespace(text[start - 1]!)) start--;
  const token = text.slice(start, end);
  return token.startsWith("@") ? { query: token.slice(1), start, end } : null;
}
