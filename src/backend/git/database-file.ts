import { closeSync, constants, openSync } from "node:fs";
import { dirname } from "node:path";
import { checkDatabase, directory, syncDirectory } from "../sessions/files.js";
import { GitError } from "../../contracts/git.js";
export function prepareGitDatabase(filename: string) {
  try {
    directory(dirname(filename));
    try {
      const fd = openSync(filename, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
      closeSync(fd); syncDirectory(dirname(filename));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    checkDatabase(filename);
  } catch { throw new GitError({ code: "STORAGE", message: "Git operation storage is unsafe or inaccessible. Check ownership, private permissions, symlinks and available disk space." }); }
}
