export type Token = { text: string; color?: string; fontStyle?: number };
export type Highlight = Token[][] | null;
export const CHAT_THEME = "github-dark";
export const CHAT_CACHE_BYTES = 4 * 1024 * 1024;
export const CHAT_CACHE_ENTRIES = 128;
export const MAX_CODE_LENGTH = 128 * 1024;
export const MAX_TOKENIZE_LINE = 1000;
export function highlightBytes(key: string, lines: Highlight) {
  return 128 + key.length * 2 + (lines?.reduce((sum, line) => sum + 32 + line.reduce((n, token) => n + 96 + token.text.length * 2 + (token.color?.length ?? 0) * 2, 0), 0) ?? 0);
}
