import { existingPath, snapshot } from "./filesystem.js";
import { FileToolError, MAX_OUTPUT_BYTES, type FileOperation, type FileResult } from "./types.js";

export async function readText(path: string, operation: Extract<FileOperation, { name: "read" }>, signal: AbortSignal): Promise<FileResult> {
  const file = await snapshot(await existingPath(path), signal);
  // Keep raw-byte hashes, but expose editor-friendly text. Edit restores the original BOM/CRLF.
  const text = file.text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const start = operation.offset - 1;
  const selected: string[] = [];
  let bytes = 0, total = 0, position = 0, capped = false;
  // Do not split the entire file: a newline-dense file could allocate millions of array entries.
  while (position < text.length) {
    const newline = text.indexOf("\n", position);
    const end = newline < 0 ? text.length : newline;
    if (total >= start && selected.length < operation.limit && !capped) {
      const line = text.slice(position, end);
      const size = Buffer.byteLength(line) + (selected.length ? 1 : 0);
      if (bytes + size > MAX_OUTPUT_BYTES) {
        if (!selected.length) throw new FileToolError(`Line ${total + 1} exceeds the 64 KiB output limit. Use Bash for bounded inspection of this line; it was not silently cut.`);
        capped = true;
      } else { selected.push(line); bytes += size; }
    }
    total++; position = end + 1;
  }
  if (start >= total && !(start === 0 && !total)) throw new FileToolError(`offset ${operation.offset} is beyond the end of the file (${total} lines).`);
  const end = start + selected.length;
  const next = end < total ? end + 1 : null;
  return { status: "completed", path: operation.path, content: selected.join("\n"), sha256: file.hash, bytes: file.bytes.length,
    start_line: operation.offset, end_line: end, total_lines: total, next_offset: next,
    summary: total ? `Read lines ${operation.offset}–${end} of ${total}.${next ? ` Continue with offset=${next}.` : " End of file."}` : "Read empty file." };
}
