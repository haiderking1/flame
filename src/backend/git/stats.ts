import { GitError, type GitLineStats, type GitStatus } from "../../contracts/git.js";
import { gitCommand } from "./command.js";
import { diskFile, MAX_FILE } from "./disk-file.js";

const UNTRACKED_BYTES = 16 * 1024 * 1024;
const UNTRACKED_FILES = 128;
const invalidStats = () => new GitError({ code: "COMMAND", message: "Git returned invalid line statistics." });
export function parseNumstat(output: string): Map<string, GitLineStats> {
  const records = output.split("\0"), result = new Map<string, GitLineStats>();
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (!record) continue;
    const first = record.indexOf("\t"), second = record.indexOf("\t", first + 1);
    if (first < 1 || second < first + 2) throw invalidStats();
    const added = record.slice(0, first), deleted = record.slice(first + 1, second);
    let path = record.slice(second + 1);
    if (!path) {
      const previous = records[++i]; path = records[++i] ?? "";
      if (!previous || !path) throw invalidStats();
    }
    if (added === "-" && deleted === "-") result.set(path, { additions: null, deletions: null });
    else {
      if (!/^\d+$/.test(added) || !/^\d+$/.test(deleted) || !Number.isSafeInteger(Number(added)) || !Number.isSafeInteger(Number(deleted))) throw invalidStats();
      result.set(path, { additions: Number(added), deletions: Number(deleted) });
    }
  }
  return result;
}
export function addedFileStats(bytes: Buffer): GitLineStats {
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { additions: null, deletions: null }; }
  if (bytes.includes(0)) return { additions: null, deletions: null };
  let additions = 0;
  for (const byte of bytes) if (byte === 10) additions++;
  if (bytes.length && bytes[bytes.length - 1] !== 10) additions++;
  return { additions, deletions: 0 };
}
async function untrackedStats(root: string, files: GitStatus["files"], signal?: AbortSignal) {
  const pending = files.filter(file => file.index === "?").slice(0, UNTRACKED_FILES);
  const result = new Map<string, GitLineStats>();
  let cursor = 0, remaining = UNTRACKED_BYTES;
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
    while (cursor < pending.length && remaining >= MAX_FILE) {
      if (signal?.aborted) throw new GitError({ code: "UNAVAILABLE", message: "Git statistics were interrupted." });
      const file = pending[cursor++]!;
      remaining -= MAX_FILE;
      try {
        const bytes = await diskFile(root, file.path, false);
        remaining += MAX_FILE - bytes.length;
        result.set(file.path, addedFileStats(bytes));
      } catch {
        // Missing/unreadable/oversized source is unknown, never a fabricated zero.
        remaining += MAX_FILE;
      }
    }
  }));
  return result;
}
export async function repositoryStats(root: string, files: GitStatus["files"], signal?: AbortSignal): Promise<GitStatus["files"]> {
  if (!files.length) return files;
  const args = ["--numstat", "-z", "--no-ext-diff", "--no-textconv", "--find-renames", "--ignore-submodules=all"];
  const [stagedOutput, workingOutput, untracked] = await Promise.all([
    gitCommand(root, ["diff", "--cached", ...args], { signal, timeout: 10_000 }),
    gitCommand(root, ["diff", ...args], { signal, timeout: 10_000 }),
    untrackedStats(root, files, signal),
  ]);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const staged = parseNumstat(decoder.decode(stagedOutput.stdout)), working = parseNumstat(decoder.decode(workingOutput.stdout));
  return files.map(file => ({ ...file, stagedStats: staged.get(file.path) ?? null, workingStats: working.get(file.path) ?? untracked.get(file.path) ?? null }));
}
