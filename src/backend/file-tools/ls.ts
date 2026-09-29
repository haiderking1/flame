import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { FileToolError, MAX_LS_BYTES, type FileOperation, type FileResult } from "./types.js";

export async function listDirectory(path: string, operation: Extract<FileOperation, { name: "ls" }>, signal: AbortSignal): Promise<FileResult> {
  signal.throwIfAborted();
  if (!(await stat(path)).isDirectory()) throw new FileToolError("The path is not a directory. Use read to inspect a file.");
  signal.throwIfAborted();
  const names = await readdir(path);
  signal.throwIfAborted();
  names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
  const lines: string[] = [];
  let bytes = 0, skipped = 0, entryLimit = false, byteLimit = false;
  for (const name of names) {
    signal.throwIfAborted();
    if (lines.length >= operation.limit) { entryLimit = true; break; }
    let directory: boolean;
    try { directory = (await stat(join(path, name))).isDirectory(); }
    catch { signal.throwIfAborted(); skipped++; continue; }
    // Keep one entry per line, even for names containing newlines or terminal controls.
    const label = /["\\\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(name)
      ? JSON.stringify(name).replace(/[\u007f-\u009f\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`) : name;
    const line = label + (directory ? "/" : "");
    const size = Buffer.byteLength(line) + (lines.length ? 1 : 0);
    if (bytes + size > MAX_LS_BYTES) { byteLimit = true; break; }
    lines.push(line); bytes += size;
  }
  signal.throwIfAborted();
  const notices = [
    ...(entryLimit ? [`${operation.limit} entries limit reached. Use a larger limit or list a specific subdirectory.`] : []),
    ...(byteLimit ? ["50 KiB output limit reached. List a more specific directory or use a targeted search."] : []),
    ...(skipped ? [`${skipped} unavailable entr${skipped === 1 ? "y was" : "ies were"} omitted.`] : []),
  ];
  return { status: "completed", path: operation.path, entries: lines.length, truncated: entryLimit || byteLimit,
    content: lines.length ? lines.join("\n") : names.length ? "(no displayable entries)" : "(empty directory)",
    summary: [`Listed ${lines.length} entr${lines.length === 1 ? "y" : "ies"}.`, ...notices].join(" ") };
}
