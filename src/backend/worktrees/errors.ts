import { GitError } from "../../contracts/git.js";
import { WorktreeError } from "../../contracts/worktrees.js";

/** A worktree could not be prepared for a response; the message is shown as the response's outcome. */
export class WorktreeSetupFailure extends Error {}
export const worktreeError = (code: WorktreeError["code"], message: string) => new WorktreeError({ code, message });
/** Git failures keep their code and safe message; anything else becomes a generic failure. */
export function asWorktreeError(error: unknown, fallback = "The worktree operation failed. Try again.") {
  if (error instanceof WorktreeError) return error;
  if (error instanceof GitError) return new WorktreeError({ code: error.code, message: error.message });
  return new WorktreeError({ code: "STORAGE", message: fallback });
}
export const errorMessage = (error: unknown) => error instanceof GitError || error instanceof WorktreeError ? error.message
  : error instanceof Error && error.message ? error.message : "Unknown error";
