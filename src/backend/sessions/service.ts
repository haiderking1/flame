import type { ImageStore } from "../images/store.js";
import { EventEmitter } from "node:events";
import type { ModelSelection } from "../../contracts/models.js";
import type { SessionDocument, SessionLocation, SessionSummary } from "../../contracts/sessions.js";
import type { AgentRecord } from "../../contracts/agents.js";
import type { CodexModels } from "../models/service.js";
import type { BashStore } from "../bash/store.js";
import type { FileOperationStore } from "../file-tools/store.js";
import type { TurnStore } from "./turn-store.js";
import type { CompactionStore } from "./compaction-store.js";
import type { MailboxStore } from "./mailbox-store.js";
import { SessionRepository, summary } from "./repository.js";
import type { WorkspaceRecord } from "./workspace-record.js";
import type { TitleRecord } from "./title-record.js";
import type { SessionWorkspace } from "../../contracts/session-workspace.js";

export type AgentEntry = { record: AgentRecord; summary: SessionSummary };
const key = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
/**
 * The threads of every project, and the subagents their agents started. Subagents are sessions too, but never listed as
 * threads: they emit "agents" with their thread's location when they change.
 */
export class Sessions extends EventEmitter {
  private index: { sessions: SessionSummary[]; warnings: string[] };
  private readonly agentIndex = new Map<string, AgentEntry>();
  constructor(private readonly repository: SessionRepository, private readonly models: Pick<CodexModels, "state" | "validateSelection">) {
    super();
    const { agents, ...index } = repository.list();
    this.index = index;
    for (const agent of agents) this.agentIndex.set(key(agent.summary), agent);
  }
  snapshot() { return this.index; }
  /** The subagent record of a session, or null for a thread. */
  agent(location: SessionLocation) { return this.agentIndex.get(key(location)) ?? null; }
  /** Every subagent of a thread, however deep. */
  agentsOf(root: SessionLocation) {
    return [...this.agentIndex.values()].filter(agent => agent.summary.projectId === root.projectId && agent.record.rootSessionId === root.sessionId);
  }
  allAgents() { return [...this.agentIndex.values()]; }
  /** The thread a session belongs to: itself, or the thread whose agent started this subagent. */
  rootOf(location: SessionLocation): SessionLocation {
    const agent = this.agent(location);
    return agent ? { projectId: location.projectId, sessionId: agent.record.rootSessionId } : location;
  }
  createAgent(location: SessionLocation, settings: ModelSelection, record: AgentRecord, fork: unknown[]) {
    const document = this.repository.createAgent(location, settings, record, fork);
    this.agentIndex.set(key(location), { record, summary: summary(document) });
    this.emit("agents", this.rootOf(location));
    return document;
  }
  mailbox<T>(location: SessionLocation, work: (store: MailboxStore) => T) { return this.repository.use(location, db => work(db.mailbox)); }
  /** Deletes a thread's subagent; its thread was deleted, or is being. */
  removeAgent(location: SessionLocation) {
    const agent = this.agent(location);
    if (!agent) return;
    this.repository.remove(location, this.read(location).revision);
    this.agentIndex.delete(key(location));
    this.emit("agents", this.rootOf({ projectId: location.projectId, sessionId: agent.record.rootSessionId }));
  }
  turns<T>(location: SessionLocation, work: (store: TurnStore) => T) { return this.repository.use(location, (db) => work(db.turns)); }
  compactions<T>(location: SessionLocation, work: (store: CompactionStore) => T) { return this.repository.use(location, db => work(db.compactions)); }
  jobs<T>(location: SessionLocation, work: (store: BashStore) => T) { return this.repository.use(location, (db) => work(db.jobs)); }
  files<T>(location: SessionLocation, work: (store: FileOperationStore) => T) { return this.repository.use(location, (db) => work(db.files)); }
  images<T>(location: SessionLocation, work: (store: ImageStore) => T) { return this.repository.use(location, db => work(db.images)); }
  warn(message: string) { this.index = { ...this.index, warnings: [...this.index.warnings, message] }; this.emit("change"); }
  publish(document: SessionDocument) {
    const agent = this.agent(document);
    if (agent) {
      this.agentIndex.set(key(document), { ...agent, summary: summary(document) });
      this.emit("agents", this.rootOf(document));
      return document;
    }
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
  workspace<T>(location: SessionLocation, work: (record: WorkspaceRecord) => T) { return this.repository.use(location, db => work(db.workspace)); }
  titles<T>(location: SessionLocation, work: (record: TitleRecord) => T) { return this.repository.use(location, db => work(db.titles)); }
  /** The session's index entry, without opening its database. */
  find(location: SessionLocation) {
    return this.index.sessions.find(item => item.sessionId === location.sessionId && item.projectId === location.projectId) ?? null;
  }
  configureWorkspace(location: SessionLocation, revision: number, next: SessionWorkspace) {
    return this.publish(this.repository.use(location, db => db.workspace.configure(revision, next)));
  }
  /** Records backend workspace progress; null when `change` declined. */
  updateWorkspace(location: SessionLocation, change: (current: SessionWorkspace) => SessionWorkspace | null) {
    const document = this.repository.use(location, db => db.workspace.update(change));
    return document && this.publish(document);
  }
  /** Throws unless the conversation could rewind to before this message now. */
  rewindable(location: SessionLocation, revision: number, entryId: string) { this.repository.use(location, db => db.rewind.check(revision, entryId)); }
  checkpointTurn(location: SessionLocation, entryId: string) { return this.repository.use(location, db => db.rewind.turnFor(entryId)); }
  abandonedTurns(location: SessionLocation) { return this.repository.use(location, db => db.rewind.abandonedTurns()); }
  rewind(location: SessionLocation, revision: number, entryId: string) {
    const result = this.repository.use(location, db => db.rewind.to(revision, entryId));
    this.publish(result.document);
    return result;
  }
  /** Deletes a session; emits "removed" with its last summary, so its worktree can be kept track of. */
  remove(location: SessionLocation, revision: number) {
    const removed = this.find(location);
    this.repository.remove(location, revision);
    this.index = { ...this.index, sessions: this.index.sessions.filter((item) => item.sessionId !== location.sessionId || item.projectId !== location.projectId) };
    this.emit("change");
    if (removed) this.emit("removed", removed);
  }
}
