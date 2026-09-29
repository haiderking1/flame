import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { IMAGE_CHUNK_BYTES, MAX_IMAGE_BYTES } from "../../contracts/image-types.js";
export function readImageChunk(path: string, size: number, offset: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size || size > MAX_IMAGE_BYTES) throw new Error("Invalid image read range.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== size || process.getuid && stat.uid !== process.getuid() || process.platform !== "win32" && (stat.mode & 0o077)) throw new Error("Stored image changed.");
    const chunk = Buffer.alloc(Math.min(size - offset, IMAGE_CHUNK_BYTES));
    let read = 0;
    while (read < chunk.length) { const count = readSync(fd, chunk, read, chunk.length - read, offset + read); if (!count) throw new Error("Stored image ended early."); read += count; }
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("Stored image changed during transfer.");
    const end = offset + read;
    return { data: chunk.toString("base64"), next: end < size ? end : null };
  } finally { closeSync(fd); }
}
