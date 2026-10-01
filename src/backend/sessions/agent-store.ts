import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { AgentRecord } from "../../contracts/agents.js";
import type { SessionDocument } from "../../contracts/sessions.js";
import { SessionError } from "../../contracts/sessions.js";

const invalid = (message: string) => new SessionError({ code: "INVALID", message });
/** Whether this session is a subagent, and of which thread; with the conversation it was forked from. */
export class AgentStore {
  constructor(private readonly db: DatabaseSync, private readonly read: () => SessionDocument, private readonly transaction: <T>(work: () => T) => T) {}
  record(): AgentRecord | null {
    const row = this.db.prepare(`SELECT root_session_id AS rootSessionId, parent_session_id AS parentSessionId, path, nickname, task, created_at AS createdAt
      FROM agent WHERE singleton=1`).get();
    return row ? Schema.decodeUnknownSync(AgentRecord)({ ...row }) : null;
  }
  /** The conversation a new agent inherited, ahead of its own; compaction folds it into a summary like any other. */
  fork(): unknown[] {
    const row = this.db.prepare("SELECT fork FROM agent WHERE singleton=1").get();
    return row ? JSON.parse(String(row.fork)) as unknown[] : [];
  }
  /** Makes a new, empty session an agent. */
  initialize(record: AgentRecord, fork: unknown[], title: string) {
    record = Schema.decodeUnknownSync(AgentRecord)(record);
    const encoded = JSON.stringify(fork);
    if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw invalid("The conversation to fork exceeds the agent storage limit.");
    this.transaction(() => {
      const current = this.read();
      if (this.record()) return;
      if (current.leafId !== null) throw invalid("Only a new session can become an agent.");
      this.db.prepare("INSERT INTO agent(singleton,root_session_id,parent_session_id,path,nickname,task,created_at,fork) VALUES (1,?,?,?,?,?,?,?)")
        .run(record.rootSessionId, record.parentSessionId, record.path, record.nickname, record.task, record.createdAt, encoded);
      this.db.prepare("UPDATE session SET title=?, custom_title=1 WHERE singleton=1").run(title.slice(0, 160) || record.nickname);
    });
  }
}
