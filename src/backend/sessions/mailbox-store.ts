import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";

export type MailKind = "task" | "message" | "final";
export type Mail = { id: string; createdAt: number; kind: MailKind; sender: string; text: string };
const MAX_TEXT_BYTES = 1024 * 1024, MAX_PENDING = 1024;
/** Messages to this session's agent from other agents of its team, kept until its agent reads them. */
export class MailboxStore {
  constructor(private readonly db: DatabaseSync, private readonly read: () => SessionDocument, private readonly transaction: <T>(work: () => T) => T) {}
  post(kind: MailKind, sender: string, text: string): Mail {
    if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new SessionError({ code: "INVALID", message: "Agent messages are limited to 1 MiB." });
    return this.transaction(() => {
      this.read();
      if (this.pendingCount() >= MAX_PENDING) throw new SessionError({ code: "INVALID", message: "This agent has too many unread messages." });
      const mail = { id: randomUUID(), createdAt: Date.now(), kind, sender, text };
      this.db.prepare("INSERT INTO mailbox(id,created_at,kind,sender,text) VALUES (?,?,?,?,?)").run(mail.id, mail.createdAt, kind, sender, text);
      return mail;
    });
  }
  pending(): Mail[] {
    return this.db.prepare("SELECT id, created_at AS createdAt, kind, sender, text FROM mailbox WHERE delivered_at IS NULL ORDER BY created_at, rowid").all()
      .map(row => ({ id: String(row.id), createdAt: Number(row.createdAt), kind: String(row.kind) as MailKind, sender: String(row.sender), text: String(row.text) }));
  }
  pendingCount() { return Number(this.db.prepare("SELECT count(*) AS count FROM mailbox WHERE delivered_at IS NULL").get()?.count ?? 0); }
  /** Marks mail as read by the agent; it is in the agent's conversation from then on. */
  delivered(ids: readonly string[]) {
    if (!ids.length) return;
    this.transaction(() => {
      const mark = this.db.prepare("UPDATE mailbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL"), now = Date.now();
      for (const id of ids) mark.run(now, id);
    });
  }
}
