import type { ImageInfo } from "../../contracts/image-types.js";

export const MAX_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_ARGUMENT_BYTES = 1024 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_LINES = 2000;
export const DEFAULT_LS_LIMIT = 500;
export const MAX_LS_BYTES = 50 * 1024;
export type Replacement = { oldText: string; newText: string };
export type FileOperation =
  | { name: "ls"; path: string; limit: number }
  | { name: "read"; path: string; offset: number; limit: number }
  | { name: "edit"; path: string; edits: Replacement[]; expected_sha256: string | null }
  | { name: "write"; path: string; content: string; expected_sha256: string | null };
export type FileResult = {
  status: "completed" | "failed" | "uncertain";
  path: string;
  summary: string;
  error?: string;
  content?: string;
  entries?: number;
  truncated?: boolean;
  sha256?: string;
  bytes?: number;
  start_line?: number;
  end_line?: number;
  total_lines?: number;
  next_offset?: number | null;
  image?: ImageInfo;
};
export class FileToolError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); }
}
export class FilePersistenceFailure extends Error {
  constructor(phase: "claim" | "result", readOnly = false) {
    super(phase === "claim" ? "Could not save the file-operation claim. No new file operation was started. Check disk space and permissions."
      : readOnly ? "The read-only operation finished, but its result could not be saved. No files were changed by this operation. Check disk space and permissions; it will not be replayed."
      : "The file operation finished, but its result could not be saved. The file may already have changed. Check disk space and inspect the file before continuing; it will not be replayed.");
  }
}
export function fileError(error: unknown): string {
  if (error instanceof FileToolError) return error.message;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  switch (code) {
    case "ENOENT": return "File or parent directory does not exist.";
    case "EACCES": case "EPERM": return "Permission denied.";
    case "EISDIR": return "The path is a directory, not a regular file.";
    case "ENOTDIR": return "A path component is not a directory.";
    case "ELOOP": return "The path contains a symlink loop or changed during the operation.";
    case "ENOSPC": case "EDQUOT": return "Not enough disk space or storage quota.";
    case "ENAMETOOLONG": return "The filesystem path is too long.";
    default: return "Filesystem operation failed. Inspect the file before retrying.";
  }
}
