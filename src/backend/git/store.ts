import { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import { GitError, GitOperation, type GitStart } from "../../contracts/git.js";
import { prepareGitDatabase } from "./database-file.js";
import { sameStart } from "./same-start.js";
import { upgradeOperation } from "./store-migration.js";

const decode = Schema.decodeUnknownSync(GitOperation);
export class GitStore {
  private readonly db: DatabaseSync;
  constructor(filename: string) {
    prepareGitDatabase(filename);
    this.db = new DatabaseSync(filename);
    try {
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1 && version !== 2) throw new GitError({ code: "STORAGE", message: "This Git operation database was created by a newer Flame version. It has not been modified." });
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;");
      if (version === 0) this.db.exec(`CREATE TABLE IF NOT EXISTS git_operations (request_id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
        CREATE INDEX IF NOT EXISTS git_operations_project ON git_operations(project_id); PRAGMA user_version=2;`);
      else this.db.prepare("SELECT request_id, project_id, payload FROM git_operations LIMIT 0").all();
      // Version 2 replaced staging scope, remote and branch fields with t3-style actions; older rows are converted in place.
      if (version === 1) {
        for (const row of this.db.prepare("SELECT request_id, payload FROM git_operations").all()) {
          this.db.prepare("UPDATE git_operations SET payload=? WHERE request_id=?").run(JSON.stringify(upgradeOperation(JSON.parse(String(row.payload)))), String(row.request_id));
        }
        this.db.exec("PRAGMA user_version=2;");
      }
      this.db.exec("CREATE INDEX IF NOT EXISTS git_operations_state ON git_operations(json_extract(payload,'$.state'));");
      for (const row of this.db.prepare("SELECT payload FROM git_operations WHERE json_extract(payload,'$.state')='running'").all()) {
        const operation = decode(JSON.parse(String(row.payload)));
        if (operation.state === "running") this.update({ ...operation, state: "interrupted", hook: null, detail: "Flame stopped during this action. It has not been replayed. Inspect Git status and the remote before retrying.", updatedAt: Date.now() });
      }
      this.db.exec("COMMIT");
    } catch (error) { if (this.db.isTransaction) this.db.exec("ROLLBACK"); this.db.close(); throw error; }
  }
  get(id: string): GitOperation | null {
    const row = this.db.prepare("SELECT payload FROM git_operations WHERE request_id=?").get(id);
    return row ? decode(JSON.parse(String(row.payload))) : null;
  }
  list(projectId: string): GitOperation[] {
    return this.db.prepare("SELECT payload FROM git_operations WHERE project_id=? ORDER BY rowid DESC LIMIT 100").all(projectId).map(row => decode(JSON.parse(String(row.payload))));
  }
  claim(input: GitStart) {
    const old = this.get(input.requestId);
    if (old) {
      if (!sameStart(input, old)) throw new GitError({ code: "INVALID", message: "This request ID already belongs to a different Git action." });
      return old;
    }
    const now = Date.now();
    const operation: GitOperation = { ...input, state: "running", phase: "Checking repository...", phases: [], phaseStartedAt: now, hook: null, detail: null, commit: null, result: null, createdAt: now, updatedAt: now };
    this.db.prepare("INSERT INTO git_operations VALUES (?, ?, ?)").run(input.requestId, input.projectId, JSON.stringify(operation));
    return operation;
  }
  update(operation: GitOperation) { this.db.prepare("UPDATE git_operations SET payload=? WHERE request_id=?").run(JSON.stringify(operation), operation.requestId); }
  close() { this.db.close(); }
}
