import type { DatabaseSync } from "node:sqlite";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import type { ImageInfo } from "../../contracts/image-types.js";
import { CHAIN } from "./chain.js";

const invalid = (message: string) => new SessionError({ code: "INVALID", message });
export type Rewound = { document: SessionDocument; text: string; images: readonly ImageInfo[] };
/**
 * T3 Code's "Edit from here": the conversation goes back to just before one of its user messages. The leaf moves to that
 * message's parent; the later entries stay saved on their own branch but are no longer part of the conversation, so the
 * model never sees them again. Only while idle, so no response or Bash job is still writing to that history.
 */
export class Rewind {
  constructor(private readonly db: DatabaseSync, private readonly read: () => SessionDocument, private readonly expect: (revision: number) => SessionDocument,
    private readonly transaction: <T>(work: () => T) => T, private readonly assertIdle: () => void, private readonly jobsRunning: () => boolean,
    private readonly images: (entryId: string) => readonly ImageInfo[]) {}
  /** The user message, checked: it must be part of the conversation as it stands. */
  message(entryId: string) {
    const row = this.db.prepare(`${CHAIN} SELECT e.id, e.parent_id AS parentId, e.text FROM entries e WHERE e.id=? AND e.kind='user' AND e.id IN (SELECT id FROM chain)`).get(entryId);
    if (!row) throw invalid("The message to rewind is no longer available.");
    return { parentId: row.parentId === null ? null : String(row.parentId), text: String(row.text) };
  }
  /** Checks a rewind could happen now, before files are restored for it. */
  check(revision: number, entryId: string) {
    this.transaction(() => { this.ready(revision); this.message(entryId); });
  }
  to(revision: number, entryId: string): Rewound {
    return this.transaction(() => {
      this.ready(revision);
      const message = this.message(entryId);
      this.db.prepare("UPDATE session SET leaf_id=?, revision=revision+1, updated_at=? WHERE singleton=1").run(message.parentId, Math.max(Date.now(), this.read().updatedAt));
      return { document: this.read(), text: message.text, images: this.images(entryId) };
    });
  }
  /** The response that answered this message first, whose checkpoint holds the files from just before it. */
  turnFor(entryId: string) {
    const row = this.db.prepare("SELECT id FROM turns WHERE user_id=? AND operation='response' ORDER BY created_at, rowid LIMIT 1").get(entryId);
    return row ? String(row.id) : null;
  }
  /** Responses no longer part of the conversation, whose checkpoints can go. */
  abandonedTurns() {
    return this.db.prepare(`${CHAIN} SELECT id FROM turns WHERE operation='response' AND user_id NOT IN (SELECT id FROM chain)`).all().map(row => String(row.id));
  }
  private ready(revision: number) {
    this.expect(revision);
    this.assertIdle();
    if (this.jobsRunning()) throw invalid("Stop running Bash jobs before rewinding this thread.");
  }
}
