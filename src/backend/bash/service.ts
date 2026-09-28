import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import type { SessionLocation } from "../../contracts/sessions.js";
import { SessionError } from "../../contracts/sessions.js";
import type { Sessions } from "../sessions/service.js";
import { BashJobs } from "./jobs.js";
import type { StoredJob } from "./store.js";
import { processIdentity, recoverGroup } from "./platform.js";
const key = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
const invalid = (message: string) => new SessionError({ code: "INVALID", message });
export class BashRuntime extends EventEmitter {
  private readonly jobs = new BashJobs();
  private readonly active = new Map<string, { location: SessionLocation; job: StoredJob }>();
  private readonly timer: NodeJS.Timeout;
  private closed = false;
  private readonly suppressed = new Set<string>();
  constructor(private sessions: Sessions, private projectPath: (id: string) => string) {
    super();
    for (const location of sessions.snapshot().sessions) {
      try {
        sessions.jobs(location, store => {
          for (const job of store.list()) if (job.status === "running" || job.status === "claimed") {
            let cleaned = false;
            try { cleaned = recoverGroup(job.pid, job.identity); } catch { /* Preserve an unknown outcome, never replay. */ }
            store.save({ ...job, status: "interrupted", outputClosed: true,
              message: cleaned ? "Interrupted by backend shutdown. The verified process group was stopped; the command was not replayed."
                : "Interrupted; process ownership could not be verified. The command may have had effects. It was not replayed." });
          }
        });
      } catch { sessions.warn(`Bash jobs in session ${location.sessionId} could not be recovered. No commands were replayed.`); }
    }
    this.jobs.on("completed", (id: string) => this.checkpoint(id));
    this.jobs.on("outputClosed", (id: string) => this.checkpoint(id));
    this.timer = setInterval(() => { for (const id of this.active.keys()) this.checkpoint(id); }, 400);
    this.timer.unref();
  }
  list(location: SessionLocation) {
    return this.sessions.jobs(location, store => {
      const jobs = store.list();
      return jobs.filter((job, index) => index >= jobs.length - 50 || job.status === "running" || job.status === "claimed")
        .map(({ accountKey, pid, identity, notified, ...job }) => job);
    });
  }
  get(location: SessionLocation, id: string) { return this.sessions.jobs(location, store => store.list().find(job => job.id === id)); }
  ledger(location: SessionLocation) {
    const jobs = this.sessions.jobs(location, store => store.list().slice(-20));
    return jobs.length ? [{ role: "user", content: [{ type: "input_text", text: `[Saved Bash job ledger; not a new human request. Do not replay commands with unknown outcomes.]\n${JSON.stringify(jobs.map(job => ({ id: job.id, command: job.command, status: job.status, exitCode: job.exitCode, signal: job.signal, output: job.text.slice(-8192), message: job.message })))}` }] }] : [];
  }
  resumeSession(location: SessionLocation) { this.suppressed.delete(key(location)); }
  pending(location: SessionLocation, account: string) { return this.suppressed.has(key(location)) ? [] : this.sessions.jobs(location, store => store.pending(account)); }
  acknowledge(location: SessionLocation, ids: string[]) {
    this.sessions.jobs(location, store => store.acknowledge(ids));
    for (const id of ids) { const active = this.active.get(id); if (active) active.job = { ...active.job, notified: true }; }
  }
  private checkpoint(id: string) {
    const running = this.active.get(id);
    if (!running || this.closed) return;
    const snapshot = this.jobs.snapshot(id);
    const next: StoredJob = { ...running.job, status: snapshot.status, exitCode: snapshot.exitCode, signal: snapshot.signal,
      text: snapshot.output.text, truncated: snapshot.output.truncated, outputClosed: snapshot.outputClosed, message: snapshot.error };
    if (JSON.stringify(next) === JSON.stringify(running.job)) return;
    try {
      this.sessions.jobs(running.location, store => store.save(next));
      running.job = next;
      this.emit("change", key(running.location));
      if (snapshot.status !== "running") this.emit("completed", running.location);
      if (snapshot.outputClosed) { this.jobs.release(id); this.active.delete(id); }
    } catch {
      this.suppressed.add(key(running.location));
      // Do not let output checkpoints fail silently while side effects continue.
      try { this.jobs.stop(id); } catch { /* The durable claim remains for recovery. */ }
      this.emit("storageFailure", running.location);
    }
  }
  async execute(location: SessionLocation, turnId: string, callId: string, accountKey: string,
    command: string, background: boolean, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.closed) throw invalid("Bash is shutting down.");
    const previous = this.sessions.jobs(location, store => store.list().find(job => job.turnId === turnId && job.callId === callId));
    if (previous) {
      if (previous.command !== command || previous.background !== background) throw invalid("Tool call identifier was reused with different arguments.");
      return previous; // A retry observes the claim, never launches again.
    }
    if (this.sessions.jobs(location, store => store.list().length) >= 256) throw invalid("This session has reached its Bash job limit. Start a new session.");
    const cwd = this.projectPath(location.projectId);
    const job: StoredJob = { id: randomUUID(), turnId, callId, command, background, accountKey, pid: null, identity: null,
      notified: !background, status: "claimed", exitCode: null, signal: null, text: "", truncated: false,
      outputClosed: false, message: null, createdAt: Date.now() };
    this.sessions.jobs(location, store => store.save(job));
    this.active.set(job.id, { location, job });
    try {
      this.jobs.start({ command, cwd, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: homedir(),
        LANG: process.env.LANG ?? "C.UTF-8", TERM: "dumb", ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) } }, {
        id: job.id, beforeExecute: pid => {
          signal.throwIfAborted();
          const next = { ...job, pid, identity: processIdentity(pid), status: "running" as const };
          this.sessions.jobs(location, store => store.save(next));
          this.active.get(job.id)!.job = next;
          this.emit("change", key(location));
        },
      });
    } catch {
      this.active.delete(job.id);
      const failed = { ...job, status: "failed" as const, outputClosed: true, message: "Could not launch this command. It was not replayed." };
      this.sessions.jobs(location, store => store.save(failed));
      this.emit("change", key(location));
      return failed;
    }
    this.emit("change", key(location));
    if (!background) {
      const stop = () => { try { this.jobs.stop(job.id); } catch { /* Completion or storage failure may already have released it. */ } };
      const waitCleanup = new AbortController();
      signal.addEventListener("abort", stop, { once: true });
      try {
        if (signal.aborted) stop();
        await Promise.race([this.jobs.wait(job.id), new Promise<never>((_, reject) => {
          const abort = () => reject(new Error("Bash wait cancelled"));
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true, signal: waitCleanup.signal });
        })]);
        // Give already queued pipe reads a chance to run, without waiting for
        // descendant-held handles or adding a command deadline.
        await new Promise<void>(resolve => setImmediate(resolve));
      } finally { waitCleanup.abort(); signal.removeEventListener("abort", stop); }
    }
    return this.sessions.jobs(location, store => store.list().find(saved => saved.id === job.id)!);
  }
  stop(location: SessionLocation, id: string) {
    const running = this.active.get(id);
    if (!running || key(running.location) !== key(location)) throw invalid("This Bash job is no longer running.");
    this.jobs.stop(id);
  }
  stopTurn(location: SessionLocation, turnId: string) {
    const ids = [...this.active].filter(([, running]) => key(running.location) === key(location) && running.job.turnId === turnId).map(([id]) => id);
    this.terminate(location, ids, false);
  }
  private terminate(location: SessionLocation, ids: string[], allNotifications: boolean) {
    const errors: unknown[] = [];
    try {
      const notifications = allNotifications ? this.sessions.jobs(location, store => store.list().filter(job => !job.notified).map(job => job.id)) : ids;
      this.acknowledge(location, notifications);
    } catch (error) { errors.push(error); }
    // Storage failure must never prevent OS cancellation of known processes.
    for (const id of ids) { try { this.jobs.stop(id); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, "Some Bash jobs or notifications could not be stopped cleanly.");
  }
  stopSession(location: SessionLocation) {
    this.suppressed.add(key(location));
    const ids = [...this.active].filter(([, running]) => key(running.location) === key(location)).map(([id]) => id);
    this.terminate(location, ids, true);
  }
  close() {
    this.closed = true; clearInterval(this.timer);
    const errors: unknown[] = [];
    for (const running of this.active.values()) {
      try { this.sessions.jobs(running.location, store => store.save({ ...running.job, status: ["claimed", "running"].includes(running.job.status) ? "interrupted" : running.job.status, notified: true,
        message: "Flame shut down and requested process-group termination. Partial effects may remain; the command was not replayed." })); }
      catch (error) { errors.push(error); }
    }
    try { this.jobs.close(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, "Bash shutdown could not fully persist or clean up jobs.");
  }
}
