import { workActivity } from "./work-activity.js";
import { randomUUID } from "node:crypto";
import type { BashRuntime } from "../bash/service.js";
import type { FileTools } from "../file-tools/service.js";
import { FilePersistenceFailure } from "../file-tools/types.js";
import { agentLoop, notificationInput } from "./agent-loop.js";
import { EventEmitter } from "node:events";
import type { ModelSelection } from "../../contracts/models.js";
import type { SessionLocation } from "../../contracts/sessions.js";
import type { TurnSnapshot } from "../../contracts/turns.js";
import type { CodexAuth } from "../auth/service.js";
import type { CodexModels } from "../models/service.js";
import type { Sessions } from "../sessions/service.js";
import { turnInvalid } from "../sessions/turn-store.js";
import { CodexInferenceClient, InferenceFailure } from "./client.js";
import { paragraphBoundary } from "./paragraphs.js";
import { turnContext } from "./compaction-context.js";
import { agentContext } from "./agent-context.js";
import { hasImageInput } from "./image-input.js";

type Running = { controller: AbortController; task: Promise<void>; account: string; epoch: number; status: "cancelled" | "interrupted" };
const key = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
export class Turns extends EventEmitter {
  private active = new Map<string, Running>();
  private failedWrites = new Map<string, TurnSnapshot>();
  private closed = false;
  constructor(private sessions: Sessions, private auth: CodexAuth, private models: Pick<CodexModels, "validateSelection"> & Partial<Pick<CodexModels, "supportsImages" | "contextWindow">>,
    private client: Pick<CodexInferenceClient, "run"> = new CodexInferenceClient(), private bash?: BashRuntime, private files?: FileTools) {
    super();
    for (const location of sessions.snapshot().sessions) {
      try { sessions.publish(sessions.turns(location, (store) => store.recover())); }
      catch { sessions.warn(`Session ${location.sessionId} could not recover its interrupted response. Its history was not replaced.`); }
    }
    auth.on("change", this.accountChanged);
    bash?.on("completed", this.backgroundCompleted);
    bash?.on("storageFailure", this.bashStorageFailure);
    queueMicrotask(() => { for (const location of sessions.snapshot().sessions) this.backgroundCompleted(location); });
  }
  private bashStorageFailure = (location: SessionLocation) => { this.active.get(key(location))?.controller.abort(); };
  private backgroundCompleted = (location: SessionLocation) => {
    queueMicrotask(() => {
      if (this.closed || !this.bash || this.active.has(key(location)) || this.failedWrites.has(key(location)) || this.active.size >= 4) return;
      const account = this.auth.usageSession();
      if (!account) return;
      try {
        const pending = this.bash.pending(location, account.key);
        if (!pending.length) return;
        const document = this.sessions.read(location);
        if (!document.settings) return;
        const settings = this.models.validateSelection(account.key, document.settings);
        const initial = [notificationInput(pending)];
        const requestId = randomUUID();
        const saved = this.sessions.turns(location, store => store.backgroundStart(requestId, settings, account.key, initial));
        this.bash.acknowledge(location, pending.map(job => job.id));
        const running: Running = { controller: new AbortController(), task: Promise.resolve(), account: account.key, epoch: account.epoch, status: "cancelled" };
        this.active.set(key(location), running);
        this.sessions.publish(saved); this.emit("change", key(location));
        running.task = Promise.resolve().then(() => this.execute({ ...location, requestId }, settings, account, running, initial));
      } catch { this.sessions.warn("A background Bash notification could not be delivered. Its job record was preserved; no command was replayed."); }
    });
  };
  private accountChanged = () => {
    const account = this.auth.usageSession();
    for (const running of this.active.values()) if (!account || account.key !== running.account || account.epoch !== running.epoch) running.controller.abort();
    if (account) for (const location of this.sessions.snapshot().sessions) this.backgroundCompleted(location);
  };
  snapshot(location: SessionLocation) { return this.failedWrites.get(key(location)) ?? this.sessions.turns(location, (store) => store.snapshot()); }
  private assertImageModel(account: string, settings: ModelSelection, input: unknown[]) {
    if (hasImageInput(input) && this.models.supportsImages?.(account, settings.modelId) === false) throw turnInvalid("This model does not accept images. Choose an image-capable model; your attachments have been kept.");
  }
  async start(input: SessionLocation & { revision: number; requestId: string; text: string; accountKey: string; images?: readonly string[] }) {
    if (this.closed) throw turnInvalid("Flame is shutting down.");
    // A retry only acknowledges the existing turn, never starts another provider request.
    const existing = this.sessions.turns(input, (store) => store.snapshot(input.requestId));
    if (existing) {
      const settings = this.sessions.read(input).settings;
      return this.sessions.turns(input, (store) => store.start(input.revision, input.requestId, input.text, settings!, "", input.images));
    }
    if (this.active.size >= 4) throw turnInvalid("Four responses are already running. Stop one before starting another.");
    if (!this.auth.usageSession()) await this.auth.refresh();
    if (this.closed) throw turnInvalid("Flame is shutting down.");
    const account = this.auth.usageSession();
    if (!account || account.key !== input.accountKey) throw turnInvalid("Account changed or disconnected. Check Providers before sending.");
    const retried = this.sessions.turns(input, (store) => store.snapshot(input.requestId));
    if (!retried && this.active.size >= 4) throw turnInvalid("Four responses are already running. Stop one before starting another.");
    const document = this.sessions.read(input);
    if (!document.settings) throw turnInvalid("Choose a model before sending to OpenAI.");
    const settings: ModelSelection = this.models.validateSelection(input.accountKey, document.settings);
    this.assertImageModel(account.key, settings, [{ content: this.sessions.images(input, store => store.content(input.images ?? [])) }]);
    // Recheck after credential refresh: concurrent retries may have already started this ID.
    const duplicate = this.sessions.turns(input, (store) => store.snapshot(input.requestId));
    const saved = this.sessions.turns(input, (store) => store.start(input.revision, input.requestId, input.text, settings, account.key, input.images));
    if (duplicate) return saved;
    this.bash?.resumeSession(input);
    const controller = new AbortController();
    const running: Running = { controller, task: Promise.resolve(), account: account.key, epoch: account.epoch, status: "cancelled" };
    this.active.set(key(input), running);
    this.sessions.publish(saved); this.emit("change", key(input));
    running.task = Promise.resolve().then(() => this.execute(input, settings, account, running));
    return saved;
  }
  async compact(input: SessionLocation & { revision: number; requestId: string; accountKey: string }) {
    if (this.closed) throw turnInvalid("Flame is shutting down.");
    const existing = this.sessions.turns(input, store => store.snapshot(input.requestId));
    if (existing) {
      if (existing.operation !== "compaction") throw turnInvalid("This request identifier belongs to a response.");
      return this.sessions.read(input);
    }
    if (this.active.size >= 4) throw turnInvalid("Four responses are already running. Stop one before compacting.");
    if (!this.auth.usageSession()) await this.auth.refresh();
    const account = this.auth.usageSession();
    if (this.closed || !account || account.key !== input.accountKey) throw turnInvalid("Account changed or disconnected. Check Providers before compacting.");
    if (this.active.size >= 4) throw turnInvalid("Four responses are already running. Stop one before compacting.");
    const document = this.sessions.read(input);
    if (!document.settings) throw turnInvalid("Choose a model before compacting.");
    const settings = this.models.validateSelection(account.key, document.settings);
    const duplicate = this.sessions.turns(input, store => store.snapshot(input.requestId));
    if (duplicate) {
      if (duplicate.operation !== "compaction") throw turnInvalid("This request identifier belongs to a response.");
      return this.sessions.read(input);
    }
    const saved = this.sessions.turns(input, store => store.manualStart(input.revision, input.requestId, settings, account.key));
    const running: Running = { controller: new AbortController(), task: Promise.resolve(), account: account.key, epoch: account.epoch, status: "cancelled" };
    this.active.set(key(input), running);
    this.sessions.publish(saved); this.emit("change", key(input));
    running.task = Promise.resolve().then(() => this.execute(input, settings, account, running, [], true));
    return saved;
  }
  private async execute(location: SessionLocation & { requestId: string }, settings: ModelSelection,
    account: NonNullable<ReturnType<CodexAuth["usageSession"]>>, running: Running, initialOutput: unknown[] = [], manual = false) {
    const startedAt = Date.now();
    let text = "", delivered = "", storageFailed = false;
    const checkpoint = () => {
      if (storageFailed) return;
      const boundary = paragraphBoundary(text.slice(delivered.length));
      if (!boundary) return;
      const next = text.slice(0, delivered.length + boundary);
      try {
        this.sessions.turns(location, (store) => store.checkpoint(location.requestId, next));
        delivered = next; this.emit("change", key(location));
      } catch { storageFailed = true; running.controller.abort(); }
    };
    const interval = setInterval(checkpoint, 400);
    let status: "completed" | "cancelled" | "failed" | "interrupted" = "completed";
    let message: string | null = null, output: unknown[] = [...initialOutput];
    try {
      running.controller.signal.throwIfAborted();
      const supportsImages = this.models.supportsImages?.(account.key, settings.modelId) !== false;
      const request = { ...account, settings, input: [], sessionId: location.sessionId, supportsImages };
      const client: Pick<CodexInferenceClient, "run"> = { run: (next, stream, signal) => {
        if (!supportsImages && hasImageInput(next.input)) throw new InferenceFailure("This model does not accept images. Choose an image-capable model; saved image reads and attachments have been preserved.");
        return this.client.run(next, stream, signal);
      } };
      const context = turnContext(this.sessions, this.models, client, location, settings, request, running.controller.signal, manual,
        account.key, () => output.length, () => [...(this.bash?.ledger(location) ?? []), ...(this.files?.ledger(location) ?? [])], () => this.emit("change", key(location)));
      if (!supportsImages && hasImageInput(context.input)) throw new InferenceFailure("This model does not accept images. Choose an image-capable model; saved image reads and attachments have been preserved.");
      if (manual) {
        context.setOverhead((await agentContext(location, this.bash, this.files, running.controller.signal)).overhead);
        await context.compact("manual");
      } else {
        const result = await agentLoop(client, { ...request, input: context.input }, this.bash,
          location, location.requestId, account.key, running.controller.signal, next => { text = next; }, (next, items) => {
            try { this.sessions.turns(location, store => store.progress(location.requestId, next, items)); output = [...items]; delivered = next; this.emit("change", key(location)); }
            catch (error) { storageFailed = true; running.controller.abort(); throw error; }
          }, initialOutput, this.files, context);
        running.controller.signal.throwIfAborted();
        text = result.text; output = result.output;
        context.publish();
      }
    } catch (error) {
      status = running.controller.signal.aborted ? running.status : "failed";
      message = storageFailed ? "Could not save the response. Check disk space and permissions."
        : error instanceof FilePersistenceFailure ? error.message
        : status === "cancelled" ? manual ? "Compaction stopped. Your full history was preserved." : "Response stopped. It was not replayed."
        : status === "interrupted" ? manual ? "Flame stopped before compaction finished. Your full history was preserved." : "Flame stopped before this response finished. It was not replayed."
        : error instanceof InferenceFailure ? error.message : manual ? "Could not compact this conversation. Your history was preserved." : "Could not complete this response. It was not replayed.";
    } finally {
      clearInterval(interval);
      if (running.controller.signal.aborted) { try { this.bash?.stopTurn(location, location.requestId); } catch { /* Job records retain the actual process status. */ } }
    }
    try { this.sessions.publish(this.sessions.turns(location, (store) => store.finish(location.requestId, status, text, message, output))); }
    catch {
      const activity = workActivity(location.requestId, delivered, output, "interrupted", startedAt, null);
      this.failedWrites.set(key(location), { id: location.requestId, status: "interrupted", text: delivered, ...(activity ? { activity } : {}),
        message: "The response could not be saved. Check disk space, then restart Flame to recover. It will not be replayed.", revision: -1, entryId: null });
    } finally {
      this.active.delete(key(location)); this.emit("change", key(location));
      for (const session of this.sessions.snapshot().sessions) this.backgroundCompleted(session);
    }
  }
  stop(location: SessionLocation, id: string) {
    const snapshot = this.snapshot(location);
    if (snapshot?.id !== id) throw turnInvalid("The active response changed. Reopen this session.");
    const running = this.active.get(key(location));
    if (snapshot.status === "running" && running) {
      running.controller.abort();
      if (snapshot.operation !== "compaction") this.bash?.stopSession(location);
    }
  }
  async close() {
    this.closed = true; this.auth.off("change", this.accountChanged);
    this.bash?.off("completed", this.backgroundCompleted); this.bash?.off("storageFailure", this.bashStorageFailure);
    for (const running of this.active.values()) { running.status = "interrupted"; running.controller.abort(); }
    await Promise.all([...this.active.values()].map((running) => running.task));
  }
}
