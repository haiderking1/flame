import { constants, openSync, closeSync, fstatSync, readSync, writeFileSync, fsyncSync, linkSync, unlinkSync, copyFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { checkId, directory, syncDirectory } from "../sessions/files.js";
import { MAX_IMAGE_BYTES } from "../../contracts/image-types.js";
export const hashImage = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
export function imagePath(root: string, id: string, variant: "original" | "model") {
  checkId(id); directory(root, true); return join(root, `${id}.${variant}`);
}
export function readImageFile(path: string, size: number, hash: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== size || size > MAX_IMAGE_BYTES || process.getuid && stat.uid !== process.getuid() || process.platform !== "win32" && (stat.mode & 0o077)) throw new Error("Stored image is unavailable or changed.");
    const data = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) { const count = readSync(fd, data, offset, size - offset, offset); if (!count) break; offset += count; }
    const after = fstatSync(fd);
    if (offset !== size || after.size !== size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || hashImage(data) !== hash) throw new Error("Stored image is unavailable or changed.");
    return data;
  } finally { closeSync(fd); }
}
export function saveImageFile(root: string, id: string, variant: "original" | "model", data: Uint8Array) {
  const path = imagePath(root, id, variant), temp = join(root, `.${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, data); fsyncSync(fd);
    try { linkSync(temp, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      readImageFile(path, data.length, hashImage(data));
    }
  } finally { closeSync(fd); unlinkSync(temp); }
  syncDirectory(root);
}

// Adoption uses the filesystem's copy-on-write clone when available. The
// fallback is a kernel file copy, with no decode or RPC/body retransmission.
// Source artifacts remain intact until the destination metadata commits.
export function copyImageFile(root: string, id: string, variant: "original" | "model", source: string, bytes: number, hash: string) {
  const path = imagePath(root, id, variant), temp = join(root, `.${randomUUID()}.tmp`);
  const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(sourceFd);
    if (!before.isFile() || before.nlink !== 1 || before.size !== bytes || bytes > MAX_IMAGE_BYTES
      || process.getuid && before.uid !== process.getuid() || process.platform !== "win32" && (before.mode & 0o077)) throw new Error("Stored image is unavailable or changed.");
    copyFileSync(source, temp, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    const after = fstatSync(sourceFd), current = lstatSync(source);
    if (current.isSymbolicLink() || current.ino !== before.ino || current.dev !== before.dev || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Stored image is unavailable or changed.");
    readImageFile(temp, bytes, hash);
    const fd = openSync(temp, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(temp, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      readImageFile(path, bytes, hash);
    }
  } finally {
    closeSync(sourceFd);
    try { unlinkSync(temp); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  syncDirectory(root);
}
