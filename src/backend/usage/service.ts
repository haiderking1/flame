import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { UsageError, type UsageState, type ResetConfirmation, type ResetOutcome } from "../../contracts/usage.js";
import { CodexUsageClient, type UsageSession } from "./client.js";
import type { UsageStore } from "./store.js";
import type { CodexAuth } from "../auth/service.js";

const TTL = 60_000;
const uncertainMessage = "A reset request has an unknown outcome. No further resets will be sent from Flame. Check your usage on ChatGPT before taking any further action.";
const managedMessage = "ChatGPT shows how much of your plan Flame has used. Open ChatGPT → Settings → Usage.";
const failure = (error: unknown) => error instanceof UsageError ? error.message : "Codex usage could not be saved or read. Check disk space and permissions.";
type Intent = ResetConfirmation & { session: UsageSession; credit: string };

export class CodexUsage extends EventEmitter {
  state: UsageState = { connected: false, managedInChatGPT: false, snapshot: null, message: null };
  private session: UsageSession | null = null;
  private controller = new AbortController();
  private flight?: Promise<void>;
  private spending?: Promise<ResetOutcome>;
  private intent?: Intent;
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private readonly auth: Pick<CodexAuth, "usageSession" | "on" | "removeListener">,
    private readonly store: UsageStore, private readonly client = new CodexUsageClient()) {
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
    this.intent = undefined;
    this.flight = undefined;
    // Sign in with ChatGPT may only call the public API; its usage lives in ChatGPT's settings.
    this.state = { connected: !!next, managedInChatGPT: next?.method === "chatgpt", snapshot: null, message: null };
    if (next && next.method !== "chatgpt") {
      try { this.state = { ...this.state, snapshot: this.store.load(next.key) }; this.decorate(); }
      catch (error) { this.state = { ...this.state, message: failure(error) }; }
    }
    this.emit("change");
    if (this.timer) void this.refresh();
  };
  private current(session: UsageSession) {
    const current = this.auth.usageSession();
    return !this.closed && current?.key === session.key && current.epoch === session.epoch;
  }
  private requireSession() {
    const session = this.auth.usageSession();
    if (!session || this.closed) throw new UsageError({ message: "Sign in to OpenAI in Providers first." });
    if (session.method === "chatgpt") throw new UsageError({ message: managedMessage });
    return session;
  }
  private decorate() {
    if (!this.session) return;
    const uncertain = this.store.uncertain(this.session.key);
    this.state = { ...this.state, message: uncertain ? uncertainMessage : this.state.message,
      snapshot: this.state.snapshot ? { ...this.state.snapshot, canReset: !uncertain && (this.state.snapshot.availableResets ?? 0) > 0 } : null };
  }
  watch(publish: () => void) {
    this.on("change", publish);
    publish();
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh(); }, TTL);
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
    if (!session || session.method === "chatgpt" || this.closed) return Promise.resolve();
    const age = Date.now() - (this.state.snapshot?.fetchedAt ?? 0);
    if (!force && age >= 0 && age < TTL) return Promise.resolve();
    const signal = this.controller.signal;
    const task = (async () => {
      try {
        const { snapshot } = await this.client.read(session, signal);
        if (!this.current(session)) return;
        this.store.save(session.key, snapshot);
        this.state = { connected: true, managedInChatGPT: false, snapshot, message: null };
        this.decorate();
      } catch (error) {
        if (!this.current(session)) return;
        this.state = { ...this.state, message: failure(error) };
      }
      this.emit("change");
    })();
    this.flight = task;
    void task.finally(() => { if (this.flight === task) this.flight = undefined; });
    return task;
  }
  async prepare(): Promise<ResetConfirmation> {
    const session = this.requireSession();
    this.intent = undefined;
    if (this.store.uncertain(session.key)) throw new UsageError({ message: uncertainMessage });
    const details = await this.client.credits(session, this.controller.signal);
    if (!this.current(session)) throw new UsageError({ message: "Account changed. Open the confirmation again." });
    const credit = details.credits.find((item) => !this.store.blocked(session.key, item.id));
    if (details.available < 1 || !credit) throw new UsageError({ message: "No eligible banked reset is currently available." });
    const confirmation = { id: randomUUID(), title: credit.title, expiresAt: Math.min(Date.now() + 120_000, credit.expiresAt ?? Infinity) };
    this.intent = { ...confirmation, credit: credit.id, session };
    return confirmation;
  }
  cancel(id: string) { if (this.intent?.id === id) this.intent = undefined; }
  async confirm(id: string): Promise<ResetOutcome> {
    const session = this.requireSession();
    const previous = this.store.outcome(session.key, id);
    if (previous) return previous; // RPC retries/reconnects cannot replay the POST.
    const intent = this.intent;
    if (!intent || intent.id !== id || intent.expiresAt <= Date.now() || !this.current(intent.session)) {
      throw new UsageError({ message: "This confirmation expired or was cancelled. Open it again." });
    }
    this.intent = undefined;
    if (!this.store.claim(session.key, intent.credit, id)) throw new UsageError({ message: "This reset is already submitted or unavailable. It was not sent again." });
    this.decorate();
    this.emit("change");
    // Persist the one-shot claim before any network I/O. A crash or lost response stays unknown.
    const task = (async () => {
      const outcome = await this.client.consume(session, intent.credit, id, this.controller.signal);
      try { this.store.finish(session.key, id, outcome); } catch { return "unknown" as const; }
      if (this.current(session)) {
        await this.flight;
        await this.refresh(true);
      }
      return outcome;
    })();
    this.spending = task;
    return task;
  }
  async close() {
    this.closed = true;
    this.controller.abort();
    clearInterval(this.timer);
    this.auth.removeListener("change", this.syncAccount);
    await Promise.allSettled([this.flight, this.spending]);
    this.removeAllListeners();
  }
}
