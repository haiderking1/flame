import type { ImageStore } from "../images/store.js";
import { EventEmitter } from "node:events";
import type { ModelSelection } from "../../contracts/models.js";
import type { SessionDocument, SessionLocation } from "../../contracts/sessions.js";
import type { CodexModels } from "../models/service.js";
import type { BashStore } from "../bash/store.js";
import type { FileOperationStore } from "../file-tools/store.js";
import type { TurnStore } from "./turn-store.js";
import type { CompactionStore } from "./compaction-store.js";
import { SessionRepository, summary } from "./repository.js";

export class Sessions extends EventEmitter {
  private index: ReturnType<SessionRepository["list"]>;
  constructor(private readonly repository: SessionRepository, private readonly models: Pick<CodexModels, "state" | "validateSelection">) {
    super();
    this.index = repository.list();
  }
  snapshot() { return this.index; }
  turns<T>(location: SessionLocation, work: (store: TurnStore) => T) { return this.repository.use(location, (db) => work(db.turns)); }
  compactions<T>(location: SessionLocation, work: (store: CompactionStore) => T) { return this.repository.use(location, db => work(db.compactions)); }
  jobs<T>(location: SessionLocation, work: (store: BashStore) => T) { return this.repository.use(location, (db) => work(db.jobs)); }
  files<T>(location: SessionLocation, work: (store: FileOperationStore) => T) { return this.repository.use(location, (db) => work(db.files)); }
  images<T>(location: SessionLocation, work: (store: ImageStore) => T) { return this.repository.use(location, db => work(db.images)); }
  warn(message: string) { this.index = { ...this.index, warnings: [...this.index.warnings, message] }; this.emit("change"); }
  publish(document: SessionDocument) {
    this.index = { ...this.index, sessions: [...this.index.sessions.filter((item) => item.sessionId !== document.sessionId || item.projectId !== document.projectId), summary(document)]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.sessionId.localeCompare(b.sessionId)) };
    this.emit("change");
    return document;
  }
  create(location: SessionLocation) {
    const selection = this.models.state.selection;
    const account = this.models.state.accountKey;
    let settings: ModelSelection | null = null;
    if (selection && account) {
      try { settings = this.models.validateSelection(account, selection); } catch { /* A session can be created while signed out. */ }
    }
    return this.publish(this.repository.create(location, settings));
  }
  read(location: SessionLocation) { return this.repository.use(location, (db) => db.read()); }
  history(location: SessionLocation, before: string | null) { return this.repository.use(location, (db) => db.history(before)); }
  draft(location: SessionLocation, revision: number, draft: string) {
    return this.publish(this.repository.use(location, (db) => db.draft(revision, draft)));
  }
  rename(location: SessionLocation, revision: number, title: string) {
    return this.publish(this.repository.use(location, (db) => db.rename(revision, title)));
  }
  settle(location: SessionLocation, revision: number, settled: boolean) {
    return this.publish(this.repository.use(location, (db) => db.settle(revision, settled)));
  }
  append(location: SessionLocation, revision: number, requestId: string, text: string, images: readonly string[] = []) {
    return this.publish(this.repository.use(location, (db) => db.append(revision, requestId, text, images)));
  }
  configure(location: SessionLocation, revision: number, accountKey: string, settings: ModelSelection) {
    const validated = this.models.validateSelection(accountKey, settings);
    return this.publish(this.repository.use(location, (db) => db.configure(revision, validated)));
  }
  remove(location: SessionLocation, revision: number) {
    this.repository.remove(location, revision);
    this.index = { ...this.index, sessions: this.index.sessions.filter((item) => item.sessionId !== location.sessionId || item.projectId !== location.projectId) };
    this.emit("change");
  }
}
