import { access, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function exists(path: string) {
  try { await access(path); return true; } catch { return false; }
}
export async function canonicalPath(path: string) {
  try { return await realpath(path); } catch { return path; }
}
export function resolveContextPath(path: string) {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\"))) return resolve(join(homedir(), path.slice(2)));
  return resolve(path.startsWith("file://") ? fileURLToPath(path) : path);
}
