/** What the model answers when it cannot title the thread; never shown, the current title stays instead. */
export const DEFAULT_THREAD_TITLE = "New thread";
// Prompts ask for under 40 characters. This cap only stops a runaway model
// from pushing a paragraph into the sidebar and window title.
const MAX_THREAD_TITLE_CHARS = 120;

/** T3 Code's title clean-up: one line, no wrapping quotes, single spaces, at most 120 characters. */
export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw.trim().split(/\r?\n/g)[0]?.trim().replace(/^['"`]+|['"`]+$/g, "").trim().replace(/\s+/g, " ");
  if (!normalized) return DEFAULT_THREAD_TITLE;
  if (normalized.length <= MAX_THREAD_TITLE_CHARS) return normalized;
  return `${normalized.slice(0, MAX_THREAD_TITLE_CHARS - 3).replace(/[\uD800-\uDBFF]$/, "").trimEnd()}...`;
}
