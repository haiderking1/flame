import { Schema } from "effect";
import { ImageInfo } from "../../contracts/image-types.js";
import type { FileWorkDetail } from "../../contracts/work.js";
import { isFileTool } from "../file-tools/definitions.js";

export function fileWork(name: string, args: Record<string, unknown>, result: Record<string, unknown> | undefined, turnStatus: string): { command: string; file: FileWorkDetail } | undefined {
  if (!isFileTool(name)) return undefined;
  const label = name === "ls" ? "List" : name === "read" ? "Read" : name === "edit" ? "Edit" : "Write";
  const path = name === "ls" && (args.path == null || args.path === "") ? "." : typeof args.path === "string" ? args.path : "(invalid path)";
  const status = result?.status === "completed" || result?.status === "failed" || result?.status === "uncertain" || result?.status === "deferred" ? result.status
    : result?.error ? "failed" : !result && turnStatus === "running" ? "pending" : "uncertain";
  const summary = typeof result?.summary === "string" ? result.summary : status === "pending" ? "Waiting for the file operation result."
    : "No saved file result. The operation may not have run, or may have completed before interruption. Inspect before retrying.";
  // Explicitly project presentation fields only. Arguments, hashes, and provider envelopes remain backend-only.
  const content = typeof result?.content === "string" ? result.content : "";
  const preview = content.slice(0, 16 * 1024).replace(/[\uD800-\uDBFF]$/, "");
  let image: typeof ImageInfo.Type | undefined;
  if (status === "completed" && result?.image) {
    try { image = Schema.decodeUnknownSync(ImageInfo)(result.image); } catch { /* Invalid historical metadata must not become an asset request. */ }
  }
  return { command: `${label} ${path}`, file: { status, summary, output: preview, truncated: preview.length < content.length, ...(image ? { image } : {}) } };
}
