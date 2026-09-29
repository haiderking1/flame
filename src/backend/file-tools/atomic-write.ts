import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { maybeStat, sameStat, snapshot, type FileSnapshot } from "./filesystem.js";
import { FileToolError, fileError } from "./types.js";

export async function destination(path: string): Promise<string> {
  const stat = await maybeStat(path);
  if (stat) return realpath(path); // Follow existing links, never replace the link itself.
  const parent = dirname(path);
  if (parent === path) throw new FileToolError("Could not resolve the filesystem root.");
  return join(await destination(parent), basename(path));
}
async function guard(original: string, target: string, before: FileSnapshot | null, signal: AbortSignal) {
  signal.throwIfAborted();
  if (await destination(original) !== target) throw new FileToolError("A symlink or parent directory changed. Nothing was replaced; read the path again.");
  const current = await maybeStat(target);
  if (!before) {
    if (current) throw new FileToolError("Another process created the file. Nothing was replaced; read it before editing.");
  } else {
    if (!current || !sameStat(before.stat, current)) throw new FileToolError("File changed during the operation. Nothing was replaced; read it again.");
    const checked = await snapshot(target, signal);
    if (checked.hash !== before.hash || !sameStat(before.stat, checked.stat)) throw new FileToolError("File contents changed during the operation. Nothing was replaced; read it again.");
  }
  signal.throwIfAborted();
}
export async function atomicWrite(original: string, target: string, bytes: Buffer, before: FileSnapshot | null, signal: AbortSignal) {
  if (before) {
    if (before.stat.nlink !== 1n) throw new FileToolError("Refusing to replace a multiply hard-linked file, which would break its shared-file semantics. Use Bash deliberately instead.");
    if (process.geteuid && before.stat.uid !== BigInt(process.geteuid())) throw new FileToolError("Refusing to replace a file owned by another user.");
    if ((Number(before.stat.mode) & 0o7000) !== 0) throw new FileToolError("Refusing to replace a file with special permission bits. Use Bash deliberately instead.");
    await access(target, constants.W_OK);
  }
  signal.throwIfAborted();
  const firstCreated = await mkdir(dirname(target), { recursive: true });
  await guard(original, target, before, signal);
  const temporary = join(dirname(target), `.flame-${randomUUID()}.tmp`);
  let committed = false, created = false;
  try {
    const file = await open(temporary, "wx", 0o600);
    created = true;
    try {
      await file.writeFile(bytes, { signal });
      if (before && process.geteuid) {
        const temporaryStat = await file.stat({ bigint: true });
        if (temporaryStat.uid !== before.stat.uid || temporaryStat.gid !== before.stat.gid) await file.chown(Number(before.stat.uid), Number(before.stat.gid));
      }
      await file.chmod(before ? Number(before.stat.mode) & 0o777 : 0o666 & ~process.umask());
      await file.sync();
    } finally { await file.close(); }
    await guard(original, target, before, signal);
    if (before) await rename(temporary, target);
    else await link(temporary, target); // Atomic create-if-absent, unlike rename which could clobber a new file.
    committed = true;
    if (!before) await unlink(temporary);
    created = false;
    // A cancellation after the commit must not turn a successful change into a "not written" report.
    // Also persist each newly created directory entry, not only the file's immediate parent.
    const lastDirectory = firstCreated ? dirname(firstCreated) : dirname(target);
    let directoryPath = dirname(target);
    while (true) {
      const directory = await open(directoryPath, constants.O_RDONLY | constants.O_DIRECTORY);
      try { await directory.sync(); } finally { await directory.close(); }
      if (directoryPath === lastDirectory || dirname(directoryPath) === directoryPath) break;
      directoryPath = dirname(directoryPath);
    }
  } catch (error) {
    if (committed) throw new FileToolError(`The file was replaced, but final filesystem durability/cleanup could not be confirmed. ${fileError(error)} Inspect before retrying.`, true);
    throw error;
  } finally {
    if (created) await unlink(temporary).catch(() => { /* A crash or filesystem failure may leave a private temporary file; never replay it. */ });
  }
}
