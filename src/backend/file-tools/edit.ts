import { FileToolError, type Replacement } from "./types.js";

/** Match every replacement against the same original, never against prior edits. */
export function replaceText(original: string, edits: Replacement[]) {
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = original.slice(bom.length);
  const crlf = body.includes("\r\n");
  if ((crlf && /(?<!\r)\n/.test(body)) || /\r(?!\n)/.test(body)) throw new FileToolError("File has mixed or unsupported line endings. Use a hash-guarded write if you intend to replace or normalize the whole file.");
  const source = body.replace(/\r\n/g, "\n");
  const ranges = edits.map((edit, index) => {
    const oldText = edit.oldText.replace(/\r\n/g, "\n"), newText = edit.newText.replace(/\r\n/g, "\n");
    if (!oldText || /\r/.test(oldText + newText)) throw new FileToolError(`Replacement ${index + 1} must use LF or CRLF line endings and nonempty oldText.`);
    const start = source.indexOf(oldText);
    if (start < 0) throw new FileToolError(`Replacement ${index + 1}: oldText was not found exactly. No edits were applied. Read the file again.`);
    if (source.indexOf(oldText, start + 1) >= 0) throw new FileToolError(`Replacement ${index + 1}: oldText occurs more than once. Add enough surrounding text to make it unique. No edits were applied.`);
    return { start, end: start + oldText.length, newText, index };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) if (ranges[i]!.start < ranges[i - 1]!.end) {
    throw new FileToolError(`Replacements ${ranges[i - 1]!.index + 1} and ${ranges[i]!.index + 1} overlap. Merge them into one replacement. No edits were applied.`);
  }
  const chunks: string[] = [];
  let position = 0;
  for (const range of ranges) { chunks.push(source.slice(position, range.start), range.newText); position = range.end; }
  chunks.push(source.slice(position));
  const result = chunks.join("");
  return bom + (crlf ? result.replace(/\n/g, "\r\n") : result);
}
