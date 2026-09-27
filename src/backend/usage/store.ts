import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { ResetOutcome, UsageSnapshot, type ResetOutcome as Outcome } from "../../contracts/usage.js";

export class UsageStore {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS codex_usage_cache (account TEXT PRIMARY KEY, snapshot TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS codex_reset_attempts (
        id TEXT PRIMARY KEY, account TEXT NOT NULL, credit TEXT NOT NULL, outcome TEXT NOT NULL, created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS codex_reset_account ON codex_reset_attempts(account, credit);`);
  }
  load(account: string): UsageSnapshot | null {
    const row = this.db.prepare("SELECT snapshot FROM codex_usage_cache WHERE account = ?").get(account);
    if (!row) return null;
    try { return Schema.decodeUnknownSync(UsageSnapshot)(JSON.parse(String(row.snapshot))); } catch { return null; }
  }
  save(account: string, snapshot: UsageSnapshot) {
    this.db.prepare("INSERT INTO codex_usage_cache VALUES (?, ?) ON CONFLICT(account) DO UPDATE SET snapshot=excluded.snapshot").run(account, JSON.stringify(snapshot));
  }
  outcome(account: string, id: string): Outcome | null {
    const row = this.db.prepare("SELECT outcome FROM codex_reset_attempts WHERE account = ? AND id = ?").get(account, id);
    return row ? Schema.decodeUnknownSync(ResetOutcome)(row.outcome) : null;
  }
  uncertain(account: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM codex_reset_attempts WHERE account = ? AND outcome = 'unknown' LIMIT 1").get(account);
  }
  blocked(account: string, credit: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM codex_reset_attempts WHERE account = ? AND credit = ? AND outcome IN ('unknown', 'reset', 'already_redeemed') LIMIT 1").get(account, credit);
  }
  claim(account: string, credit: string, id: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.uncertain(account) || this.blocked(account, credit) || this.outcome(account, id)) { this.db.exec("ROLLBACK"); return false; }
      this.db.prepare("INSERT INTO codex_reset_attempts VALUES (?, ?, ?, 'unknown', ?)").run(id, account, credit, Date.now());
      this.db.exec("COMMIT");
      return true;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  finish(account: string, id: string, outcome: Outcome) {
    this.db.prepare("UPDATE codex_reset_attempts SET outcome = ? WHERE account = ? AND id = ?").run(outcome, account, id);
  }
  close() { this.db.close(); }
}
