import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import { SessionError, type SessionDocument } from "../../contracts/sessions.js";
import { SessionTitleState } from "../../contracts/session-title.js";
import type { ImageInfo } from "../../contracts/image-types.js";
import { mentionNames } from "../../contracts/file-mentions.js";
import { CHAIN } from "./chain.js";

const invalid = (message: string) => new SessionError({ code: "INVALID", message });
const SEED_LENGTH = 50;
/** A message of the conversation as the title model reads it. */
export type TitleMessage = { role: "user" | "assistant"; text: string; images: readonly ImageInfo[] };
/** T3 Code's first-message title: the message itself, cut to 50 characters, or the first image's name. */
export function titleSeed(text: string, images: readonly { name: string }[]) {
  const plain = mentionNames(text).replace(/\s+/g, " ").trim();
  if (!plain) return images[0] ? `Image: ${images[0].name}`.slice(0, 160) : null;
  return plain.length <= SEED_LENGTH ? plain : `${plain.slice(0, SEED_LENGTH).replace(/[\uD800-\uDBFF]$/, "")}...`;
}
/**
 * Who wrote the session's title, and the text model's work on it. The model's titles are backend progress, like a
 * renamed worktree branch, so they do not advance the revision and never make a draft saved meanwhile conflict.
 */
export class TitleRecord {
  constructor(private readonly db: DatabaseSync, private readonly read: () => SessionDocument, private readonly transaction: <T>(work: () => T) => T,
    private readonly images: (entryId: string) => readonly ImageInfo[]) {}
  state() { return this.read().titleState; }
  /** Titles the conversation after its first message while no one has named it; called as the message is saved. */
  seed(entryId: string, text: string) {
    const current = this.read();
    if (current.titleState.source !== "auto" || this.userMessages() !== 1) return;
    const seed = titleSeed(text, this.images(entryId));
    if (seed) this.write({ ...current.titleState, version: randomUUID(), needsRefinement: false }, seed);
  }
  /** A rename is the user's title: the model leaves it alone, and a regeneration still running is dropped. */
  renamed() {
    this.write({ source: "manual", version: randomUUID(), needsRefinement: false, regeneration: null });
  }
  /** Lands a title generated from the first message, unless the title changed since it was asked for. */
  generated(expected: { title: string; version: string }, title: string, needsRefinement: boolean) {
    return this.transaction(() => {
      const current = this.read(), state = current.titleState;
      if (state.source === "manual" || state.regeneration || current.title !== expected.title || state.version !== expected.version) return null;
      this.write({ source: "generated", version: randomUUID(), needsRefinement, regeneration: null }, title);
      return this.read();
    });
  }
  /** Starts the user's "Regenerate title"; the title stays as it is until the model answers. */
  regenerate(requestId: string) {
    return this.transaction(() => {
      const current = this.read();
      if (current.titleState.regeneration) throw invalid("This thread's title is already being regenerated.");
      if (!this.userMessages()) throw invalid("Send a message before regenerating this thread's title.");
      return this.begin(current, requestId);
    });
  }
  /** Retitles once after the first answer when the first message alone did not say what the thread is about. */
  refine(requestId: string, expectedVersion: string) {
    return this.transaction(() => {
      const current = this.read(), state = current.titleState;
      if (state.source !== "generated" || !state.needsRefinement || state.regeneration || state.version !== expectedVersion || this.userMessages() !== 1) return null;
      return this.begin(current, requestId);
    });
  }
  /** Ends a regeneration with its title, or with none when the model failed or kept the title; null when superseded. */
  finish(requestId: string, title: string | null) {
    return this.transaction(() => {
      const current = this.read(), state = current.titleState;
      if (state.regeneration?.requestId !== requestId) return null;
      this.write({ ...state, regeneration: null }, title ?? undefined, Math.max(Date.now(), current.updatedAt));
      return this.read();
    });
  }
  /** The conversation's only user message, while it has exactly one: the message that titles it. */
  firstMessage(): TitleMessage | null {
    if (this.userMessages() !== 1) return null;
    const row = this.db.prepare(`${CHAIN} SELECT id, text FROM entries WHERE kind='user' AND id IN (SELECT id FROM chain)`).get();
    return row ? { role: "user", text: mentionNames(String(row.text ?? "")), images: this.images(String(row.id)) } : null;
  }
  /** The conversation as it stands, user and assistant messages in order, for retitling it. */
  messages(): TitleMessage[] {
    return this.db.prepare(`${CHAIN} SELECT e.id, e.kind, e.text FROM entries e WHERE e.id IN (SELECT id FROM chain) AND e.kind IN ('user','assistant') ORDER BY e.created_at, e.rowid`).all()
      .map(row => ({ role: row.kind === "user" ? "user" as const : "assistant" as const, text: row.kind === "user" ? mentionNames(String(row.text ?? "")) : String(row.text ?? ""),
        images: row.kind === "user" ? this.images(String(row.id)) : [] }));
  }
  private userMessages() {
    return Number(this.db.prepare(`${CHAIN} SELECT COUNT(*) AS count FROM entries WHERE kind='user' AND id IN (SELECT id FROM chain)`).get()?.count ?? 0);
  }
  private begin(current: SessionDocument, requestId: string) {
    this.write({ source: "generated", version: requestId, needsRefinement: false, regeneration: { requestId, startedAt: Date.now() } });
    return { document: this.read(), previousTitle: current.title };
  }
  private write(state: SessionTitleState, title?: string, updatedAt?: number) {
    const encoded = JSON.stringify(Schema.encodeSync(SessionTitleState)(state));
    if (title === undefined) this.db.prepare("UPDATE session SET title_state=? WHERE singleton=1").run(encoded);
    else if (updatedAt === undefined) this.db.prepare("UPDATE session SET title_state=?, title=? WHERE singleton=1").run(encoded, title);
    else this.db.prepare("UPDATE session SET title_state=?, title=?, updated_at=? WHERE singleton=1").run(encoded, title, updatedAt);
  }
}
