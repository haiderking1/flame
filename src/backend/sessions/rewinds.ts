import { SessionError, type SessionLocation, type RewindResult } from "../../contracts/sessions.js";
import type { Sessions } from "./service.js";

/** What restoring files needs from session worktrees; absent where worktrees are unavailable. */
export type FileCheckpoints = {
  // The worktree whose files can be restored, or why they cannot.
  restorable(location: SessionLocation): string;
  restore(location: SessionLocation, turnId: string): Promise<void>;
  forget(location: SessionLocation, turnIds: readonly string[]): Promise<void>;
};
const invalid = (message: string) => new SessionError({ code: "INVALID", message });
/**
 * "Edit from here" (T3 Code): checks the rewind can happen, restores a worktree's files to just before the message when
 * asked, then rewinds the conversation, and lets go of checkpoints for responses that are no longer part of it.
 */
export class SessionRewinds {
  constructor(private readonly sessions: Sessions, private readonly checkpoints?: FileCheckpoints) {}
  async rewind(location: SessionLocation, revision: number, entryId: string, restoreFiles: boolean): Promise<RewindResult> {
    this.sessions.rewindable(location, revision, entryId);
    if (restoreFiles) {
      if (!this.checkpoints) throw invalid("Files cannot be restored here. Rewind the conversation without restoring files instead.");
      this.checkpoints.restorable(location);
      const turnId = this.sessions.checkpointTurn(location, entryId);
      if (!turnId) throw invalid("The files from before this message were not saved, so they cannot be restored.");
      await this.checkpoints.restore(location, turnId);
    }
    const result = this.sessions.rewind(location, revision, entryId);
    void this.checkpoints?.forget(location, this.sessions.abandonedTurns(location)).catch(() => {});
    return result;
  }
}
