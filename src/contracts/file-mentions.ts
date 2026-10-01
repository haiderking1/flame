// Mentions are stored in the prompt as Markdown file links, `[name](path)`, as in T3 Code: plain text the
// model reads naturally, that drafts and messages keep as is, and that the composer shows as chips.

export type FileMention = { path: string; directory: boolean; source: string; start: number; end: number };

export function basename(path: string) {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator >= 0 ? path.slice(separator + 1) : path;
}
const escapeLabel = (label: string) => label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
const encodeDestination = (path: string) => encodeURI(path).replaceAll("(", "%28").replaceAll(")", "%29").replaceAll("#", "%23").replaceAll("?", "%3F").replaceAll("\\", "%5C");
/** The canonical link for a mentioned project path; folders end in `/` so they read as folders. */
export function serializeFileMention(path: string, directory = false) {
  return `[${escapeLabel(basename(path))}](${encodeDestination(path)}${directory ? "/" : ""})`;
}

// The label is bounded so text like " [[[[…" can't make matching quadratic; only a basename (≤255 chars) survives anyway.
const FILE_LINK = /(^|\s)\[((?:\\.|[^\]\\]){0,512})\]\(([^)\s]+)\)(?=\s|$)/g;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/, WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;
/** File links in text whose label is the path's basename, so ordinary Markdown links stay text. */
export function findFileMentions(text: string): FileMention[] {
  const mentions: FileMention[] = [];
  for (const match of text.matchAll(FILE_LINK)) {
    const prefix = match[1] ?? "", label = (match[2] ?? "").replace(/\\(.)/g, "$1"), encoded = match[3] ?? "";
    let decoded = encoded;
    try { decoded = decodeURIComponent(encoded); } catch { /* Keep malformed text as written. */ }
    const directory = /[^/]\/$/.test(decoded), path = directory ? decoded.slice(0, -1) : decoded;
    if (!path || (URI_SCHEME.test(path) && !WINDOWS_DRIVE.test(path)) || label !== basename(path)) continue;
    const start = (match.index ?? 0) + prefix.length, end = (match.index ?? 0) + match[0].length;
    mentions.push({ path, directory, source: text.slice(start, end), start, end });
  }
  return mentions;
}

/** Text with each file mention shown as its name, for single-line summaries such as session titles. */
export function mentionNames(text: string) {
  let result = "", at = 0;
  for (const mention of findFileMentions(text)) { result += text.slice(at, mention.start) + basename(mention.path); at = mention.end; }
  return result + text.slice(at);
}
