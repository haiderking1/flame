import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { FileToolError, MAX_FILE_BYTES } from "./types.js";

export const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export function resolvePath(cwd: string, path: string) {
  if (!isAbsolute(cwd)) throw new FileToolError("Project directory must be absolute.");
  if (path.startsWith("~") && path !== "~" && !path.startsWith("~/")) throw new FileToolError("Only ~/ home expansion is supported; shell variables and ~user are not expanded.");
  return resolve(cwd, path === "~" ? homedir() : path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path);
}
export const sameStat = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
export async function maybeStat(path: string): Promise<BigIntStats | null> {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export type ByteSnapshot = { bytes: Buffer; hash: string; stat: BigIntStats };
export type FileSnapshot = ByteSnapshot & { text: string };
export async function byteSnapshot(path: string, signal: AbortSignal, maxBytes = MAX_FILE_BYTES): Promise<ByteSnapshot> {
  signal.throwIfAborted();
  // O_NONBLOCK prevents accidentally hanging on a FIFO if a path is swapped.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat({ bigint: true });
    if (!stat.isFile()) throw new FileToolError("Only regular files are supported, not directories, devices, sockets, or pipes.");
    if (stat.size > BigInt(maxBytes)) throw new FileToolError(`File exceeds the ${maxBytes / 1024 / 1024} MiB read limit. Use Bash for bounded, specialized inspection.`);
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - size));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maxBytes) throw new FileToolError(`File grew beyond the ${maxBytes / 1024 / 1024} MiB limit while reading.`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    signal.throwIfAborted();
    const after = await file.stat({ bigint: true }), current = await maybeStat(path);
    if (!sameStat(stat, after) || !current || !sameStat(stat, current)) throw new FileToolError("File changed while reading. Read it again before making changes.");
    const bytes = Buffer.concat(chunks, size);
    return { bytes, hash: digest(bytes), stat };
  } finally { await file.close(); }
}
export function textSnapshot(file: ByteSnapshot): FileSnapshot {
  if (file.bytes.length > MAX_FILE_BYTES) throw new FileToolError("File exceeds the 16 MiB text-file limit. Use Bash for bounded, specialized inspection.");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes); }
  catch { throw new FileToolError("File is not valid UTF-8. Use Bash with an explicit encoding; no lossy conversion was performed."); }
  if (text.includes("\0")) throw new FileToolError("File contains NUL bytes and appears binary. Use Bash for binary inspection.");
  return { ...file, text };
}
export async function snapshot(path: string, signal: AbortSignal): Promise<FileSnapshot> {
  return textSnapshot(await byteSnapshot(path, signal));
}
export async function existingPath(path: string) { return realpath(path); }
export function assertHash(current: FileSnapshot | null, expected: string | null, createOnly: boolean) {
  if (expected !== null && current?.hash !== expected) throw new FileToolError("File no longer matches expected_sha256 (or is missing). Nothing was replaced. Read it again and reconsider the change.");
  if (createOnly && expected === null && current) throw new FileToolError("File already exists. Read it and supply expected_sha256 to replace it; null only permits creation.");
}
