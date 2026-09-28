import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { BashJob } from "../../contracts/bash.js";
export type StoredJob = BashJob & { callId: string; accountKey: string; pid: number | null; identity: string | null; notified: boolean };
export class BashStore {
  constructor(private db: DatabaseSync, private check: () => unknown) {}
  list(): StoredJob[] {
    this.check();
    return this.db.prepare("SELECT data FROM bash_jobs ORDER BY rowid").all().map(row => {
      const value = JSON.parse(String(row.data));
      Schema.decodeUnknownSync(BashJob)(value);
      if (typeof value.callId !== "string" || typeof value.accountKey !== "string" || typeof value.notified !== "boolean"
        || (value.pid !== null && (!Number.isSafeInteger(value.pid) || value.pid <= 0))
        || (value.identity !== null && typeof value.identity !== "string")
        || Buffer.byteLength(value.text) > 64 * 1024 || Buffer.byteLength(value.command) > 64 * 1024) throw new Error("Invalid saved Bash job");
      return value as StoredJob;
    });
  }
  save(job: StoredJob) {
    this.check();
    Schema.decodeUnknownSync(BashJob)(job);
    this.db.prepare(`INSERT INTO bash_jobs(id,turn_id,call_id,data) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(job.id, job.turnId, job.callId, JSON.stringify(job));
  }
  pending(accountKey: string) { return this.list().filter(job => job.accountKey === accountKey && job.background && !job.notified && !["claimed", "running"].includes(job.status)); }
  acknowledge(ids: string[]) { for (const job of this.list()) if (ids.includes(job.id)) this.save({ ...job, notified: true }); }
}
