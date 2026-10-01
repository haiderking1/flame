import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { SessionLocation } from "../../contracts/sessions.js";
import type { TurnStatus } from "../../contracts/turn-status.js";
import type { TitleWriter } from "../git/writer/writer.js";
import type { Sessions } from "../sessions/service.js";
import { formatThreadTitleContext } from "./context.js";
import { linkedContext as readLinkedContext } from "./links.js";
import { threadTitlePrompt } from "./prompts.js";
import { DEFAULT_THREAD_TITLE, sanitizeThreadTitle } from "./sanitize.js";

const GENERATION_TIMEOUT_MS = 120_000;
// T3 Code retries a first title twice, two then four seconds apart.
const RETRY_DELAYS_MS = [2_000, 4_000];
type TurnEvents = Pick<EventEmitter, "on" | "off"> & { isRunning(location: SessionLocation): boolean };
export type ThreadTitlesOptions = {
  sessions: Sessions; writer: TitleWriter; turns: TurnEvents;
  /** The folder the session works in, for reading linked pull requests and issues with the hosting CLI. */
  root(location: SessionLocation): string;
  linkedContext?: typeof readLinkedContext;
  retryDelays?: readonly number[];
};

/**
 * T3 Code's thread titles. The first message titles the thread at once (its first 50 characters); the text model then
 * replaces that with a short title, unless the user renamed it meanwhile. When the first message alone did not say
 * what the thread is about, the thread is retitled once after the first answer. "Regenerate title" retitles it from the
 * whole conversation. Everything here is best effort: a failure leaves the title as it was.
 */
export class ThreadTitles {
  private readonly closing = new AbortController();
  private readonly tasks = new Set<Promise<void>>();
  constructor(private readonly options: ThreadTitlesOptions) {
    options.turns.on("message", this.message);
    options.turns.on("finished", this.finished);
    queueMicrotask(() => this.recover());
  }
  /** Starts "Regenerate title"; the title changes when the model answers. */
  regenerate(location: SessionLocation) {
    const requestId = randomUUID();
    const started = this.options.sessions.titles(location, record => record.regenerate(requestId));
    this.options.sessions.publish(started.document);
    this.track(this.retitle(location, requestId, started.previousTitle));
    return started.document;
  }
  async close() {
    this.options.turns.off("message", this.message);
    this.options.turns.off("finished", this.finished);
    this.closing.abort();
    await Promise.all(this.tasks);
  }
  // Runs after the message is sent, never on the way: only a thread no one has titled yet reads its first message.
  private message = (location: SessionLocation) => {
    const summary = this.options.sessions.find(location);
    if (summary?.titleState.source !== "auto" || summary.titleState.regeneration) return;
    this.track(Promise.resolve().then(() => {
      if (this.closing.signal.aborted) return;
      const expected = this.options.sessions.find(location);
      if (!expected || expected.titleState.source !== "auto" || expected.titleState.regeneration) return;
      const first = this.options.sessions.titles(location, record => record.firstMessage());
      if (first) return this.first(location, { title: expected.title, version: expected.titleState.version }, first);
    }).catch(() => { /* The session was deleted meanwhile. */ }));
  };
  private finished = (location: SessionLocation, status: TurnStatus) => { if (status === "completed") this.refine(location); };
  /** After a restart: a regeneration that was running is dropped, and a title still waiting for its refinement gets it. */
  private recover() {
    for (const session of this.options.sessions.snapshot().sessions) {
      const regeneration = session.titleState.regeneration;
      if (regeneration) this.finish(session, regeneration.requestId, null);
      else if (session.titleState.needsRefinement) this.refine(session);
    }
  }
  private async first(location: SessionLocation, expected: { title: string; version: string }, message: { text: string; images: readonly { id: string; name: string; mimeType: string; bytes: number }[] }) {
    const delays = this.options.retryDelays ?? RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        const generated = await this.generate(location, threadTitlePrompt({ message: message.text, attachments: attachments(message.images),
          linkedContext: await this.linked(location, message.text) }), message.images.map(image => image.id));
        // A model that cannot title the thread keeps the first message's title, to try again after the first answer.
        const unknown = generated.title === DEFAULT_THREAD_TITLE;
        const document = this.options.sessions.titles(location, record => record.generated(expected, unknown ? expected.title : generated.title, unknown || generated.needsRefinement));
        if (!document) return;
        this.options.sessions.publish(document);
        if (document.titleState.needsRefinement) this.refine(location);
        return;
      } catch {
        if (this.closing.signal.aborted || attempt >= delays.length) return;
        await delay(delays[attempt], undefined, { signal: this.closing.signal }).catch(() => {});
        if (this.closing.signal.aborted) return;
      }
    }
  }
  /** Retitles once from the conversation, after the first answer, when the first title needed it. */
  private refine(location: SessionLocation) {
    try {
      if (this.options.turns.isRunning(location)) return;
      const state = this.options.sessions.find(location)?.titleState;
      if (!state?.needsRefinement || state.source !== "generated" || state.regeneration) return;
      if (this.options.sessions.turns(location, store => store.state())?.status !== "completed") return;
      const requestId = randomUUID();
      const started = this.options.sessions.titles(location, record => record.refine(requestId, state.version));
      if (!started) return;
      this.options.sessions.publish(started.document);
      this.track(this.retitle(location, requestId, started.previousTitle));
    } catch { /* Retried after the next answer or restart. */ }
  }
  private async retitle(location: SessionLocation, requestId: string, previousTitle: string) {
    let title: string | null = null;
    try {
      const context = formatThreadTitleContext(this.options.sessions.titles(location, record => record.messages()));
      if (context.message) {
        const generated = await this.generate(location, threadTitlePrompt({ message: context.message, previousTitle, attachments: attachments(context.images),
          linkedContext: await this.linked(location, context.message) }), context.images.map(image => image.id));
        if (generated.title !== DEFAULT_THREAD_TITLE && generated.title !== previousTitle) title = generated.title;
      }
    } catch { /* The title stays as it was. */ }
    // On shutdown the regeneration stays recorded, and is dropped when Flame starts again.
    if (!this.closing.signal.aborted) this.finish(location, requestId, title);
  }
  private finish(location: SessionLocation, requestId: string, title: string | null) {
    try {
      const document = this.options.sessions.titles(location, record => record.finish(requestId, title));
      if (document) this.options.sessions.publish(document);
    } catch { /* The session was deleted meanwhile. */ }
  }
  private async generate(location: SessionLocation, prompt: string, imageIds: readonly string[]) {
    let images: readonly unknown[] = [];
    try { images = imageIds.length ? this.options.sessions.images(location, store => store.content(imageIds)) : []; } catch { /* Titled from the text alone. */ }
    const model = this.options.sessions.read(location).settings;
    const generated = await this.options.writer.title(prompt, model, images, AbortSignal.any([this.closing.signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]));
    return { title: sanitizeThreadTitle(generated.title), needsRefinement: generated.needsRefinement };
  }
  private async linked(location: SessionLocation, message: string) {
    let cwd: string;
    try { cwd = this.options.root(location); } catch { return undefined; }
    return (this.options.linkedContext ?? readLinkedContext)(message, cwd, this.closing.signal);
  }
  private track(task: Promise<void>) {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task));
  }
}
const attachments = (images: readonly { name: string; mimeType: string; bytes: number }[]) =>
  images.map(image => ({ name: image.name, mimeType: image.mimeType, sizeBytes: image.bytes }));
