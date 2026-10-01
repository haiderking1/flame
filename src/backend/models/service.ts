import { EventEmitter } from "node:events";
import { ModelsError, type ModelsState, type ModelSelection, type ServiceTier } from "../../contracts/models.js";
import type { CodexAuth } from "../auth/service.js";
import { CodexModelsClient, type ModelsSession } from "./client.js";
import type { ModelsStore } from "./store.js";
import { modelSelection, reconcileGitText, reconcileSelection, thinkingSelection } from "./selection.js";

const TTL = 5 * 60_000;
const storageMessage = "Models are available, but their cache could not be saved. Check disk space and permissions.";

export class CodexModels extends EventEmitter {
  state: ModelsState = { connected: false, accountKey: null, catalog: null, selection: null, message: null, gitText: null };
  private session: ModelsSession | null = null;
  private controller = new AbortController();
  private flight?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private lastAttempt = 0;
  private closed = false;
  constructor(private readonly auth: Pick<CodexAuth, "usageSession" | "on" | "removeListener">,
    private readonly store: ModelsStore, private readonly client = new CodexModelsClient()) {
    super();
    auth.on("change", this.syncAccount);
    this.syncAccount();
  }
  private syncAccount = () => {
    const next = this.auth.usageSession();
    if (next?.key === this.session?.key && next?.epoch === this.session?.epoch) { this.session = next; return; }
    this.controller.abort();
    this.controller = new AbortController();
    this.session = next;
    this.flight = undefined;
    this.lastAttempt = 0;
    this.state = { connected: !!next, accountKey: next?.key ?? null, catalog: null, selection: null, message: null, gitText: null };
    if (next) {
      try {
        const catalog = this.store.load(next.key), models = catalog?.models ?? [];
        this.state = { ...this.state, catalog, selection: reconcileSelection(models, this.store.loadSelection(next.key)),
          gitText: reconcileGitText(models, this.store.loadGitText(next.key)) };
      }
      catch { this.state = { ...this.state, message: "Could not read the model cache. Trying OpenAI directly." }; }
    }
    this.emit("change");
    if (this.timer) void this.refresh();
  };
  private current(session: ModelsSession) {
    const next = this.auth.usageSession();
    return !this.closed && next?.key === session.key && next.epoch === session.epoch;
  }
  watch(publish: () => void) {
    this.on("change", publish);
    publish();
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh(); }, 60_000);
      this.timer.unref();
    }
    void this.refresh();
    return () => {
      this.removeListener("change", publish);
      if (!this.listenerCount("change")) { clearInterval(this.timer); this.timer = undefined; }
    };
  }
  refresh(force = false): Promise<void> {
    if (this.flight) return this.flight;
    const session = this.auth.usageSession();
    if (!session || this.closed) return Promise.resolve();
    const now = Date.now();
    const age = now - (this.state.catalog?.fetchedAt ?? 0);
    if (!force && ((age >= 0 && age < TTL) || now - this.lastAttempt < 60_000)) return Promise.resolve();
    this.lastAttempt = now;
    const signal = this.controller.signal;
    const previous = this.state.catalog;
    const task = (async () => {
      try {
        const catalog = await this.client.read(session, previous, signal);
        if (!this.current(session)) return;
        this.state = { connected: true, accountKey: session.key, catalog, selection: reconcileSelection(catalog.models, this.state.selection),
          message: null, gitText: reconcileGitText(catalog.models, this.state.gitText) };
        try {
          this.state = { ...this.state, selection: reconcileSelection(catalog.models, this.store.loadSelection(session.key)),
            gitText: reconcileGitText(catalog.models, this.store.loadGitText(session.key)) };
          this.store.save(session.key, catalog);
        }
        catch { this.state = { ...this.state, message: storageMessage }; }
      } catch (error) {
        if (!this.current(session)) return;
        this.state = { ...this.state, message: error instanceof ModelsError ? error.message : "Could not fetch OpenAI models. Try again later." };
      }
      this.emit("change");
    })();
    this.flight = task;
    void task.finally(() => { if (this.flight === task) this.flight = undefined; });
    return task;
  }
  private requireAccount(accountKey: string) {
    const session = this.auth.usageSession();
    if (!session || !this.current(session) || session.key !== accountKey || this.state.accountKey !== accountKey) {
      throw new ModelsError({ message: "Account changed or disconnected. Open the picker again." });
    }
  }
  private saveSelection(accountKey: string, selection: ModelSelection) {
    try { this.store.saveSelection(accountKey, selection); }
    catch { throw new ModelsError({ message: "Could not save model settings. Check disk space and permissions." }); }
    this.state = { ...this.state, selection };
    this.emit("change");
  }
  selectModel(accountKey: string, modelId: string) {
    this.requireAccount(accountKey);
    const model = this.state.catalog?.models.find((model) => model.id === modelId);
    if (!model) throw new ModelsError({ message: "This model is no longer available. Choose a model from the current catalog." });
    this.saveSelection(accountKey, modelSelection(model, this.state.selection?.effort ?? null, this.state.selection?.serviceTier));
  }
  selectThinking(accountKey: string, modelId: string, effort: string) {
    this.requireAccount(accountKey);
    if (this.state.selection?.modelId !== modelId) throw new ModelsError({ message: "The selected model changed. Open the thinking picker again." });
    const model = this.state.catalog?.models.find((model) => model.id === modelId);
    if (!model) throw new ModelsError({ message: "This model is no longer available." });
    this.saveSelection(accountKey, thinkingSelection(model, effort, this.state.selection.serviceTier));
  }
  supportsImages(accountKey: string, modelId: string) {
    this.requireAccount(accountKey);
    return this.state.catalog?.models.find(model => model.id === modelId)?.supportsImages;
  }
  contextWindow(accountKey: string, modelId: string) {
    this.requireAccount(accountKey);
    // Older caches have no capacity metadata; use a conservative window until
    // the live catalog supplies the model's standard (not experimental) limit.
    return this.state.catalog?.models.find(model => model.id === modelId)?.contextWindow ?? 128_000;
  }
  validateSelection(accountKey: string, selection: ModelSelection): ModelSelection {
    this.requireAccount(accountKey);
    const model = this.state.catalog?.models.find((model) => model.id === selection.modelId);
    if (!model || (selection.serviceTier === "priority" && !model.supportsFast)) {
      throw new ModelsError({ message: "This model or service tier is no longer available for the connected account." });
    }
    return selection.effort === null ? modelSelection(model, null, selection.serviceTier)
      : thinkingSelection(model, selection.effort, selection.serviceTier);
  }
  /** Saves the model that writes Git text, or null to follow the chat model. */
  selectGitText(accountKey: string, selection: ModelSelection | null) {
    const validated = selection && this.validateSelection(accountKey, selection);
    if (!selection) this.requireAccount(accountKey);
    try { this.store.saveGitText(accountKey, validated); }
    catch { throw new ModelsError({ message: "Could not save the Git text model. Check disk space and permissions." }); }
    this.state = { ...this.state, gitText: validated };
    this.emit("change");
  }
  selectTier(accountKey: string, modelId: string, serviceTier: ServiceTier) {
    this.requireAccount(accountKey);
    const selection = this.state.selection;
    if (selection?.modelId !== modelId) throw new ModelsError({ message: "The selected model changed. Open the service tier picker again." });
    const model = this.state.catalog?.models.find((model) => model.id === modelId);
    if (!model || (serviceTier !== "default" && serviceTier !== "priority") || (serviceTier === "priority" && !model.supportsFast)) {
      throw new ModelsError({ message: "This service tier is not supported by the selected model." });
    }
    this.saveSelection(accountKey, { ...selection, serviceTier });
  }
  async close() {
    this.closed = true;
    this.controller.abort();
    clearInterval(this.timer);
    this.auth.removeListener("change", this.syncAccount);
    await this.flight;
    this.removeAllListeners();
  }
}
