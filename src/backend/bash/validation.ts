import { isAbsolute } from "node:path";
import type { BashRequest } from "./types.js";

export function validateBashRequest(request: BashRequest) {
  if (process.platform === "win32") throw new Error("This Bash runner requires POSIX process groups; Windows is not supported yet.");
  if (typeof request.command !== "string" || !request.command.trim() || request.command.includes("\0") || Buffer.byteLength(request.command) > 48 * 1024) {
    throw new Error("Bash command must be nonempty, contain no NUL bytes, and fit within 48 KiB.");
  }
  if (typeof request.cwd !== "string" || !isAbsolute(request.cwd) || request.cwd.includes("\0")) throw new Error("Bash requires an absolute working directory.");
  if (!request.env || typeof request.env !== "object" || Array.isArray(request.env)) throw new Error("Bash requires an explicit environment.");
  let size = 0;
  for (const [key, value] of Object.entries(request.env)) {
    if (!key || /[=\0]/.test(key) || typeof value !== "string" || value.includes("\0")) throw new Error("Invalid Bash environment entry.");
    size += Buffer.byteLength(key) + Buffer.byteLength(value) + 2;
  }
  if (size > 128 * 1024) throw new Error("Bash environment exceeds 128 KiB.");
}
