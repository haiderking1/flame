import { chmodSync, constants, closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { SessionError, type SessionLocation } from "../../contracts/sessions.js";

export const missing = () => new SessionError({ code: "NOT_FOUND", message: "This session or project no longer exists." });
export const storageError = () => new SessionError({ code: "STORAGE", message: "Could not access session storage safely. Check disk space, file ownership, and permissions." });
export const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
export const validId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export function checkId(id: string) {
  if (!validId(id)) throw new SessionError({ code: "INVALID", message: "Invalid session or project identifier." });
}
function owned(stat: { uid: number }) { if (process.getuid && stat.uid !== process.getuid()) throw storageError(); }
export function syncDirectory(path: string) {
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function directory(path: string, create = false) {
  let created = false;
  if (create) { try { mkdirSync(path, { mode: 0o700 }); created = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } }
  const stat = lstatSync(path);
  owned(stat);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError();
  if (process.platform !== "win32" && (stat.mode & 0o077)) chmodSync(path, 0o700);
  if (created) { syncDirectory(path); syncDirectory(dirname(path)); }
}
export function checkDatabase(filename: string) {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    let fd;
    try {
      fd = openSync(filename + suffix, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const stat = fstatSync(fd);
      owned(stat);
      if (!stat.isFile() || stat.nlink !== 1 || lstatSync(filename + suffix).isSymbolicLink()) throw storageError();
      if (process.platform !== "win32" && (stat.mode & 0o077)) throw storageError();
    } catch (error) { if (!suffix || !isMissing(error)) throw error; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
}
export function projectDirectory(root: string, projectId: string, create: boolean) {
  checkId(projectId);
  directory(dirname(root), create);
  directory(root, create);
  const project = join(root, projectId);
  directory(project, create);
  const sessions = join(project, "sessions");
  directory(sessions, create);
  return sessions;
}
export function sessionDirectory(root: string, location: SessionLocation) {
  checkId(location.sessionId);
  const parent = projectDirectory(root, location.projectId, false);
  const path = join(parent, location.sessionId);
  directory(path);
  return path;
}
