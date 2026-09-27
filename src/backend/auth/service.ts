import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { CodexAuthState } from "../../contracts/auth.js";
import { type Credential, OAuthFailure } from "./credentials.js";
import type { AuthStore } from "./store.js";
import { authorization, CodexTokens } from "./codex/protocol.js";
import { listenForCode } from "./codex/callback.js";

const message = (error: unknown) => error instanceof OAuthFailure ? error.message : "OpenAI authentication could not complete. Try again.";

type Options = {
  store: Pick<AuthStore, "load" | "save">;
  openBrowser(url: string): Promise<void>;
  tokens?: Pick<CodexTokens, "exchange" | "refresh">;
  callback?: typeof listenForCode;
};

export class CodexAuth extends EventEmitter {
  state: CodexAuthState = { phase: "disconnected", account: null, message: null };
  private credential: Credential | null = null;
  private generation = 0;
  private sessionAvailable = false;
  usageSession() {
    const credential = this.credential;
    if (!this.sessionAvailable || !credential || credential.expires <= Date.now() || this.closed) return null;
    return { key: createHash("sha256").update(`${credential.accountId}\0${credential.email ?? ""}`).digest("hex"),
      accountId: credential.accountId, access: credential.access, epoch: this.generation };
  }
  private active?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = Promise.resolve();
  private refreshTask?: Promise<void>;
  private loginTask?: Promise<void>;
  private failures = 0;
  private needsSave = false;
  private closed = false;
  private readonly tokens: Pick<CodexTokens, "exchange" | "refresh">;
  constructor(private readonly options: Options) { super(); this.tokens = options.tokens ?? new CodexTokens(); }

  async initialize() {
    try {
      this.credential = await this.options.store.load();
      this.publish();
      if (this.credential) this.schedule();
    } catch (error) { this.publish(message(error)); }
  }
  private publish(error: string | null = null, authorizing = false) {
    const credential = this.credential;
    this.state = {
      phase: authorizing ? "authorizing" : !credential ? "disconnected" : credential.expires > Date.now() ? "connected" : "expired",
      account: credential ? { email: credential.email, plan: credential.plan } : null,
      message: error,
    };
    this.sessionAvailable = this.state.phase === "connected";
    this.emit("change");
  }
  private enqueue(work: () => Promise<void>) {
    const task = this.pending.then(work);
    this.pending = task.catch(() => {});
    return task;
  }
  private invalidate() {
    this.generation++;
    this.sessionAvailable = false;
    this.emit("change");
    this.active?.abort();
    this.active = undefined;
    clearTimeout(this.timer);
  }
  private schedule(delay?: number) {
    clearTimeout(this.timer);
    if (this.closed || !this.credential) return;
    const remaining = this.credential.expires - Date.now();
    const wait = delay ?? Math.max(1_000, remaining - Math.min(60_000, Math.max(0, remaining) * 0.2));
    this.timer = setTimeout(() => { void this.refresh(); }, Math.min(wait, 2_147_483_647));
    this.timer.unref();
  }
  login() {
    if (this.closed || this.state.phase === "authorizing") return;
    this.invalidate();
    this.failures = 0;
    const generation = this.generation;
    const controller = this.active = new AbortController();
    this.publish(null, true);
    this.loginTask = this.completeLogin(generation, controller);
  }
  private async completeLogin(generation: number, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
    let callback: Awaited<ReturnType<typeof listenForCode>> | undefined;
    try {
      const flow = authorization();
      callback = await (this.options.callback ?? listenForCode)(flow.state, signal);
      signal.throwIfAborted();
      await this.options.openBrowser(flow.url);
      const code = await callback.code;
      const credential = await this.tokens.exchange(code, flow.verifier, signal);
      await this.enqueue(async () => {
        if (generation !== this.generation || signal.aborted || this.closed) return;
        await this.options.store.save(credential);
        if (generation !== this.generation || this.closed) return;
        this.credential = credential;
        this.needsSave = false;
        this.publish();
        this.schedule();
      });
    } catch (error) {
      if (generation === this.generation && !this.closed) {
        this.publish(signal.aborted ? "Sign-in timed out. Try again." : message(error));
        this.schedule();
      }
    } finally { callback?.close(); }
  }
  async cancel() {
    if (this.state.phase !== "authorizing") return;
    this.invalidate();
    const generation = this.generation;
    await this.loginTask;
    await this.enqueue(async () => {
      if (generation !== this.generation || this.closed) return;
      // A filesystem write already in progress cannot be aborted. Restore the
      // previous session before acknowledging cancellation of that login.
      await this.options.store.save(this.credential);
      if (generation !== this.generation || this.closed) return;
      this.publish();
      this.schedule();
    }).catch((error: unknown) => { this.publish(message(error)); throw error; });
  }
  async logout() {
    this.invalidate();
    await this.enqueue(async () => {
      await this.options.store.save(null);
      this.credential = null;
      this.needsSave = false;
      this.failures = 0;
      this.publish();
    }).catch((error: unknown) => { this.publish(message(error)); this.schedule(); throw error; });
  }
  refresh(): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    if (!this.credential || this.closed || this.state.phase === "authorizing") return Promise.resolve();
    const credential = this.credential;
    const generation = this.generation;
    const controller = this.active = new AbortController();
    this.refreshTask = (async () => {
      try {
        const updated = this.needsSave ? credential : await this.tokens.refresh(credential, controller.signal);
        await this.enqueue(async () => {
          if (generation !== this.generation || this.closed) return;
          // A rotated refresh token must not be discarded if disk persistence fails.
          this.credential = updated;
          this.needsSave = true;
          await this.options.store.save(updated);
          if (generation !== this.generation || this.closed) return;
          this.needsSave = false;
          this.failures = 0;
          this.publish();
          this.schedule();
        });
      } catch (error) {
        if (generation !== this.generation || this.closed) return;
        this.failures++;
        if (error instanceof OAuthFailure && error.terminal) {
          await this.enqueue(async () => {
            if (generation !== this.generation || this.closed) return;
            this.credential = { ...credential, expires: Date.now() - 1 };
            await this.options.store.save(null);
            if (generation !== this.generation || this.closed) return;
            this.credential = null;
            this.publish(message(error));
          }).catch((failure: unknown) => { if (generation === this.generation && !this.closed) this.publish(message(failure)); });
        } else {
          this.publish(message(error));
          if (this.failures < 5) this.schedule(Math.min(60_000 * 2 ** (this.failures - 1), 15 * 60_000));
        }
      }
    })().finally(() => { this.refreshTask = undefined; });
    return this.refreshTask;
  }
  async close() {
    this.closed = true;
    this.invalidate();
    await Promise.all([this.loginTask, this.refreshTask, this.pending]);
    this.removeAllListeners();
  }
}
