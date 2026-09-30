import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, fsyncSync, renameSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { syncDirectory } from "../sessions/files.js";

export function readStagingJson(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384 || process.getuid && stat.uid !== process.getuid()
      || process.platform !== "win32" && (stat.mode & 0o077)) throw new Error("Image staging metadata is unsafe.");
    const data = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("Image staging metadata changed while reading.");
    return JSON.parse(data.toString("utf8"));
  } finally { closeSync(fd); }
}
export function saveStagingJson(root: string, id: string, data: unknown) {
  const temp = join(root, `.${randomUUID()}.metadata`), fd = openSync(temp, "wx", 0o600);
  try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); renameSync(temp, join(root, `${id}.json`)); }
  finally { closeSync(fd); try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  syncDirectory(root);
}
