import { workActivity } from "../turns/work-activity.js";
import { dirname, join } from "node:path";
import { ImageStore } from "../images/store.js";
import { migrateImages } from "./images-migration.js";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { SessionDocument, SessionEntry, SessionError, fitsSessionText, type SessionLocation, type SessionPage } from "../../contracts/sessions.js";
import type { ModelSelection } from "../../contracts/models.js";
import { LOCAL_WORKSPACE } from "../../contracts/session-workspace.js";
import { checkDatabase, missing, storageError } from "./files.js";
import { initializeSession } from "./schema.js";
import { migrateSession } from "./migrations.js";
import { TurnStore } from "./turn-store.js";
import { migrateBash } from "./bash-migration.js";
import { migrateSettlement } from "./settlement-migration.js";
import { BashStore } from "../bash/store.js";
import { FileOperationStore } from "../file-tools/store.js";
import { migrateFileTools } from "./file-tools-migration.js";
import { migrateLs } from "./ls-migration.js";
import { migrateCompaction } from "./compaction-migration.js";
import { migrateReadImages } from "./read-images-migration.js";
import { migrateWorkspace } from "./workspace-migration.js";
import { WorkspaceRecord } from "./workspace-record.js";
import { CompactionStore } from "./compaction-store.js";
import { mentionNames } from "../../contracts/file-mentions.js";
import { CHAIN } from "./chain.js";
import { Rewind } from "./rewind.js";

const conflict = () => new SessionError({ code: "CONFLICT", message: "This session changed elsewhere. Reopen it before saving again. Your unsaved text has been kept." });
const invalid = (message: string) => new SessionError({ code: "INVALID", message });
export class SessionDatabase {
  private readonly db: DatabaseSync;
  readonly turns: TurnStore;
  readonly jobs: BashStore;
  readonly files: FileOperationStore;
  readonly images: ImageStore;
  readonly compactions: CompactionStore;
  readonly workspace: WorkspaceRecord;
  readonly rewind: Rewind;
  constructor(filename: string, private readonly location: SessionLocation, settings?: ModelSelection | null) {
    checkDatabase(filename);
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;");
      const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
      if (version === 0 && settings !== undefined) {
        this.db.exec("PRAGMA journal_mode=WAL;");
        initializeSession(this.db, location, settings);
      } else if (typeof version !== "number" || version < 1 || version > 10) throw storageError();
      const legacySettlement = typeof version !== "number" || version < 4;
      this.read(true, legacySettlement);
      if (version === 0 || version === 1) migrateSession(this.db);
      if (version === 0 || version === 1 || version === 2) migrateBash(this.db);
      if (legacySettlement) migrateSettlement(this.db);
      if (typeof version !== "number" || version < 5) migrateFileTools(this.db);
      if (typeof version !== "number" || version < 6) migrateLs(this.db);
      if (typeof version !== "number" || version < 7) migrateImages(this.db);
      if (typeof version !== "number" || version < 8) migrateCompaction(this.db);
      if (typeof version !== "number" || version < 9) migrateReadImages(this.db);
      if (version !== 10) migrateWorkspace(this.db);
      this.images = new ImageStore(this.db, join(dirname(filename), "images"), () => this.read(), work => this.transaction(work));
      this.files = new FileOperationStore(this.db, () => this.read(), work => this.transaction(work), this.images);
      this.jobs = new BashStore(this.db, () => this.read());
      this.compactions = new CompactionStore(this.db, () => this.read(), work => this.transaction(work), this.images, (id, output) => this.files.restoreResults(id, output));
      this.turns = new TurnStore(this.db, () => this.read(), (work) => this.transaction(work), (revision, id, text, images) => this.append(revision, id, text, images),
        (id, output) => this.files.restoreResults(id, output), this.images, this.compactions);
      this.workspace = new WorkspaceRecord(this.db, () => this.read(), revision => this.expect(revision), work => this.transaction(work), () => this.turns.assertIdle(),
        () => this.jobs.list().some(job => job.status === "running" || job.status === "claimed"), () => this.hasMessages());
      this.rewind = new Rewind(this.db, () => this.read(), revision => this.expect(revision), work => this.transaction(work), () => this.turns.assertIdle(),
        () => this.jobs.list().some(job => job.status === "running" || job.status === "claimed"), entryId => this.images.list(entryId));
    } catch (error) { this.db.close(); throw error; }
  }
  read(includeDeleted = false, legacy = false): SessionDocument {
    const row = this.db.prepare(`SELECT id AS sessionId, project_id AS projectId, title, created_at AS createdAt,
      updated_at AS updatedAt, revision, draft, settings, deleted, leaf_id AS leafId, ${legacy ? "NULL" : "settled_at"} AS settledAt,
      ${this.version() >= 10 ? "workspace" : "NULL"} AS workspace FROM session WHERE singleton = 1`).get();
    if (!row || row.sessionId !== this.location.sessionId || row.projectId !== this.location.projectId) throw storageError();
    if (!includeDeleted && row.deleted === 1) throw missing();
    const hasCompaction = this.version() >= 8;
    const meter = hasCompaction ? this.db.prepare(`${CHAIN} SELECT context,settings FROM turns WHERE context IS NOT NULL AND user_id IN (SELECT id FROM chain) ORDER BY created_at DESC,rowid DESC LIMIT 1`).get() : null;
    const settings = JSON.parse(String(row.settings));
    const storedContext = meter && JSON.parse(String(meter.settings)).modelId === settings?.modelId ? meter.context : null;
    const workspace = row.workspace === null ? LOCAL_WORKSPACE : JSON.parse(String(row.workspace));
    return Schema.decodeUnknownSync(SessionDocument)({ ...row, settings, workspace, ...(storedContext ? { context: JSON.parse(String(storedContext)) } : {}) });
  }
  private version() { return Number(this.db.prepare("PRAGMA user_version").get()?.user_version); }
  /** Whether anyone has sent a message yet; a new worktree can only be chosen before the first one. */
  private hasMessages() { return !!this.db.prepare("SELECT 1 FROM entries WHERE kind='user' LIMIT 1").get(); }
  private transaction<T>(work: () => T): T {
    if (this.db.isTransaction) return work();
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private expect(revision: number) {
    const current = this.read();
    if (!Number.isSafeInteger(revision) || current.revision !== revision) throw conflict();
    return current;
  }
  isDeleted() { return this.db.prepare("SELECT deleted FROM session WHERE singleton=1").get()?.deleted === 1; }
  retire(revision: number) {
    this.transaction(() => {
      if (this.db.prepare("SELECT deleted FROM session WHERE singleton=1").get()?.deleted === 1) return;
      this.expect(revision);
      this.turns.assertIdle();
      if (this.jobs.list().some(job => job.status === "running" || job.status === "claimed")) throw invalid("Stop running Bash jobs before deleting this session.");
      this.db.prepare("UPDATE session SET deleted=1, revision=revision+1 WHERE singleton=1").run();
    });
  }
  draft(revision: number, draft: string) {
    if (!fitsSessionText(draft)) throw invalid("Draft exceeds the 48 KiB encoded message limit. Shorten it before saving.");
    return this.transaction(() => {
      const current = this.expect(revision);
      if (draft !== current.draft) this.db.prepare("UPDATE session SET draft=?, revision=revision+1 WHERE singleton=1").run(draft);
      return this.read();
    });
  }
  rename(revision: number, title: string) {
    title = title.trim();
    if (!title || title.length > 160) throw invalid("Session names must be between 1 and 160 characters.");
    return this.transaction(() => {
      this.expect(revision);
      this.turns.assertIdle();
      this.db.prepare("UPDATE session SET title=?, custom_title=1, revision=revision+1, updated_at=? WHERE singleton=1").run(title, Date.now());
      return this.read();
    });
  }
  settle(revision: number, settled: boolean) {
    return this.transaction(() => {
      const current = this.expect(revision);
      if (settled) {
        this.turns.assertIdle();
        if (this.jobs.list().some(job => job.status === "running" || job.status === "claimed")) throw invalid("Stop running Bash jobs before settling this session.");
      }
      if ((current.settledAt !== null) === settled) return current;
      this.db.prepare("UPDATE session SET settled_at=?, revision=revision+1 WHERE singleton=1").run(settled ? Date.now() : null);
      return this.read();
    });
  }
  private entry(current: SessionDocument, kind: "user" | "settings", text: string | null, settings: ModelSelection | null, requestId: string | null) {
    const id = randomUUID();
    const now = Math.max(Date.now(), current.updatedAt);
    this.db.prepare("INSERT INTO entries VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, current.leafId, now, kind, text, JSON.stringify(settings), requestId);
    this.db.prepare("UPDATE session SET leaf_id=?, updated_at=?, revision=revision+1 WHERE singleton=1").run(id, now);
  }
  configure(revision: number, settings: ModelSelection) {
    return this.transaction(() => {
      const current = this.expect(revision);
      this.turns.assertIdle();
      if (JSON.stringify(settings) === JSON.stringify(current.settings)) return current;
      this.entry(current, "settings", null, settings, null);
      this.db.prepare("UPDATE session SET settings=? WHERE singleton=1").run(JSON.stringify(settings));
      return this.read();
    });
  }
  append(revision: number, requestId: string, text: string, images: readonly string[] = []) {
    if ((!text.trim() && !images.length) || !fitsSessionText(text)) throw invalid("Messages must contain text or images and text must fit within 48 KiB when encoded.");
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT id,text FROM entries WHERE request_id=?").get(requestId);
      if (previous) {
        if (previous.text !== text || JSON.stringify(this.images.list(String(previous.id)).map(image => image.id)) !== JSON.stringify(images)) throw invalid("This submission identifier was already used for a different message.");
        return this.read();
      }
      const current = this.expect(revision);
      this.turns.assertIdle();
      this.images.assertIds(images);
      this.entry(current, "user", text, current.settings, requestId);
      this.images.bind(this.read().leafId!, images);
      this.db.prepare("UPDATE session SET settled_at=NULL, draft=CASE WHEN draft=? THEN '' ELSE draft END, title=CASE WHEN custom_title=0 THEN ? ELSE title END, custom_title=1 WHERE singleton=1")
        .run(text, mentionNames(text.trim().split(/\r?\n/)[0]!).replace(/\s+/g, " ").slice(0, 120).replace(/[\uD800-\uDBFF]$/, "") || "Image attachment");
      return this.read();
    });
  }
  history(before: string | null): SessionPage {
    let tip = this.read().leafId;
    if (before) {
      const row = this.db.prepare("SELECT parent_id FROM entries WHERE id=?").get(before);
      if (!row) throw missing();
      tip = row.parent_id as string | null;
    }
    const rows = this.db.prepare(`WITH RECURSIVE chain AS (
      SELECT *, 0 AS depth FROM entries WHERE id=?
      UNION ALL SELECT e.*, c.depth+1 FROM entries e JOIN chain c ON e.id=c.parent_id WHERE c.depth < 29
    ) SELECT c.id, c.parent_id AS parentId, c.created_at AS createdAt, c.kind, c.text, c.settings,
      t.status AS turnStatus, t.id AS turnId, t.output AS output, t.created_at AS startedAt
      FROM chain c LEFT JOIN turns t ON t.entry_id=c.id ORDER BY c.depth DESC`).all(tip);
    const entries = rows.map((row) => {
      const activity = row.turnId ? workActivity(String(row.turnId), String(row.text), this.files.restoreResults(String(row.turnId), JSON.parse(String(row.output))), String(row.turnStatus), Number(row.startedAt), Number(row.createdAt)) : undefined;
      return Schema.decodeUnknownSync(SessionEntry)({ ...row, requestId: this.db.prepare("SELECT request_id FROM entries WHERE id=?").get(String(row.id))?.request_id ?? null,
        images: this.images.list(String(row.id)), settings: JSON.parse(String(row.settings)), ...(activity ? { activity } : {}) });
    });
    const compactions = this.compactions.list();
    // A checkpoint after the current leaf lives on the newest page; older
    // markers are returned only alongside their original capture entry.
    const ids = new Set(entries.map(entry => entry.id));
    return { entries, nextBefore: entries[0]?.parentId ? entries[0].id : null,
      compactions: compactions.filter(checkpoint => checkpoint.leafId === null ? before === null : ids.has(checkpoint.leafId)) };
  }
  close() { this.db.close(); }
}
