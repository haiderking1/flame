import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitError } from "../../../contracts/git.js";
import { gitCommand, gitText } from "../command.js";
import { safeGitMessage } from "../process.js";
import { traceHooks, type HookEvents } from "./hooks.js";

const PATCH_LIMIT = 49_000;
export type StagedChanges = { summary: string; patch: string };
/**
 * Stages exactly what will be committed: every change, or only the selected paths (after unstaging everything else,
 * so nothing staged earlier slips in). Returns null when nothing ends up staged.
 */
export async function stageChanges(root: string, filePaths: readonly string[] | null, signal: AbortSignal): Promise<StagedChanges | null> {
  if (filePaths) {
    const directory = await mkdtemp(join(tmpdir(), "flame-git-paths-"));
    try {
      const list = join(directory, "paths");
      await writeFile(list, filePaths.join("\0"), { mode: 0o600 });
      // HEAD may not exist yet; an unborn branch has nothing to unstage relative to it.
      await gitCommand(root, ["reset", "-q"], { signal, allowed: [0, 1, 128] });
      await gitCommand(root, ["--literal-pathspecs", "add", "-A", `--pathspec-from-file=${list}`, "--pathspec-file-nul"], { signal });
    } finally { await rm(directory, { recursive: true, force: true }); }
  } else await gitCommand(root, ["add", "-A", "--", "."], { signal });
  const summary = await gitText(root, ["diff", "--cached", "--name-status", "--"], { signal });
  if (!summary) return null;
  let patch: string;
  try {
    const output = (await gitCommand(root, ["diff", "--no-ext-diff", "--cached", "--patch", "--minimal", "--"], { signal, maxBytes: 16 * 1024 * 1024 })).stdout;
    patch = output.length > PATCH_LIMIT ? `${output.subarray(0, PATCH_LIMIT).toString("utf8")}\n\n[truncated]` : output.toString("utf8");
  } catch (error) {
    if (signal.aborted) throw error;
    patch = "[patch too large to include]";
  }
  return { summary, patch };
}
export function assertNoConflicts(files: readonly { index: string; worktree: string }[]) {
  if (files.some(file => file.index === "U" || file.worktree === "U" || file.index + file.worktree === "AA" || file.index + file.worktree === "DD")) {
    throw new GitError({ code: "INVALID", message: "Resolve merge conflicts before committing." });
  }
}
/** First line is the subject, the rest the body. */
export function splitMessage(message: string) {
  const [first = "", ...rest] = message.trim().split(/\r?\n/);
  return { subject: first.trim(), body: rest.join("\n").trim() };
}
/** Commits the index with hooks enabled, reporting hook progress; returns the new commit's SHA. */
export async function commitStaged(root: string, subject: string, body: string, hooks: HookEvents, signal: AbortSignal, identity: NodeJS.ProcessEnv = {}) {
  const trace = await traceHooks(hooks);
  try {
    await gitCommand(root, ["commit", "--cleanup=strip", "-m", subject, ...(body ? ["-m", body] : []), "--"],
      { signal, timeout: 10 * 60_000, env: { ...identity, ...trace.env }, onOutput: (_stream, text) => trace.output(safeGitMessage(text)) });
  } finally { await trace.stop(); }
  return gitText(root, ["rev-parse", "HEAD"], { signal });
}
