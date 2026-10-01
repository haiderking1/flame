import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { AuthMethod, CodexAuthState } from "../../contracts/auth.js";
import { type Credential, isChatGPT, methodOf, OAuthFailure } from "./credentials.js";
import type { AuthStore } from "./store.js";
import type { SignInMethod } from "./sign-in.js";
import { codexSignIn } from "./codex/protocol.js";
import { chatgptSignIn } from "./chatgpt/protocol.js";
import { listenForCallback } from "./callback.js";

const message = (error: unknown) => error instanceof OAuthFailure ? error.message : "OpenAI authentication could not complete. Try again.";

type Options = {
  store: Pick<AuthStore, "load" | "save" | "agentHostId">;
  openBrowser(url: string): Promise<void>;
  methods?: Partial<Record<AuthMethod, SignInMethod>>;
  callback?: typeof listenForCallback;
};
/** The signed-in account as API clients use it: Sign in with ChatGPT calls the public API, the legacy sign-in Codex's. */
export type ApiSession = { key: string; method: AuthMethod; accountId: string | null; access: string; epoch: number };
// Model choices and caches are kept per account key, so a legacy account keeps the key it always had.
const accountKey = (credential: Credential) => createHash("sha256")
  .update(isChatGPT(credential) ? `chatgpt\0${credential.subject}` : `${credential.accountId}\0${credential.email ?? ""}`).digest("hex");

/** The OpenAI sign-in, by Sign in with ChatGPT or the legacy Codex sign-in; one account at a time. */
export class CodexAuth extends EventEmitter {
  state: CodexAuthState = { phase: "disconnected", method: null, account: null, message: null };
  private credential: Credential | null = null;
  private generation = 0;
  private sessionAvailable = false;
  usageSession(): ApiSession | null {
    const credential = this.credential;
    if (!this.sessionAvailable || !credential || credential.expires <= Date.now() || this.closed) return null;
    return { key: accountKey(credential), method: methodOf(credential), accountId: isChatGPT(credential) ? null : credential.accountId,
      access: credential.access, epoch: this.generation };
  }
  private active?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = Promise.resolve();
  private refreshTask?: Promise<void>;
  private loginTask?: Promise<void>;
  private failures = 0;
  private needsSave = false;
  private closed = false;
  private readonly methods: Record<AuthMethod, SignInMethod>;
  constructor(private readonly options: Options) {
    super();
    this.methods = { chatgpt: options.methods?.chatgpt ?? chatgptSignIn(), codex: options.methods?.codex ?? codexSignIn() };
  }

  async initialize() {
    try {
      this.credential = await this.options.store.load();
      this.publish();
      if (this.credential) this.schedule();
    } catch (error) { this.publish(message(error)); }
  }
  private publish(error: string | null = null, authorizing: AuthMethod | null = null) {
    const credential = this.credential;
    this.state = {
      phase: authorizing ? "authorizing" : !credential ? "disconnected" : credential.expires > Date.now() ? "connected" : "expired",
      method: authorizing ?? (credential ? methodOf(credential) : null),
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
  /** Starts signing in by `method`; a sign-in of the other method is replaced once this one completes. */
  login(method: AuthMethod) {
    if (this.closed || this.state.phase === "authorizing") return;
    this.invalidate();
    this.failures = 0;
    const generation = this.generation;
    const controller = this.active = new AbortController();
    this.publish(null, method);
    this.loginTask = this.completeLogin(method, generation, controller);
  }
  private async completeLogin(method: AuthMethod, generation: number, controller: AbortController) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
    let callback: Awaited<ReturnType<typeof listenForCallback>> | undefined;
    try {
      const previous = this.credential && methodOf(this.credential) === method ? this.credential : null;
      const flow = await this.methods[method].authorize({ previous, hostId: () => this.options.store.agentHostId() });
      callback = await (this.options.callback ?? listenForCallback)(flow.state, signal, flow.callback);
      signal.throwIfAborted();
      await this.options.openBrowser(flow.url(callback.port));
      const params = await callback.params;
      const credential = await flow.complete(params, signal);
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
        const updated = this.needsSave ? credential : await this.methods[methodOf(credential)].refresh(credential, controller.signal);
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
