import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { OAuthFailure } from "./credentials.js";

export const storageFailure = () => new OAuthFailure("Cannot access ~/.flame/agent/auth.json safely. Check its ownership, permissions, and available disk space.");
export function owned(stat: { uid: number }) {
  if (process.getuid && stat.uid !== process.getuid()) throw storageFailure();
}
export async function privateDirectory(path: string) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = await lstat(path);
  owned(stat);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageFailure();
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { await handle.chmod(0o700); } finally { await handle.close(); }
}
export async function prepareAuthDirectory(directory: string) {
  await privateDirectory(dirname(directory));
  await privateDirectory(directory);
}
export async function readPrivateFile(path: string) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await handle.stat();
    owned(stat);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw storageFailure();
    await handle.chmod(0o600);
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}
