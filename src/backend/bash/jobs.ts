import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { BashProcess } from "./process.js";
import type { BashRequest } from "./types.js";

// Backend-owned jobs: start once, then wait or continue working. Completion
// notifications remain queued until acknowledged; observing never reruns Bash.
export class BashJobs extends EventEmitter {
  private readonly jobs = new Map<string, BashProcess>();
  private readonly pending = new Set<string>();
  private closed = false;

  start(request: BashRequest, options?: { id: string; beforeExecute(pid: number): void }): string {
    if (this.closed) throw new Error("Bash runner is closed.");
    if (this.jobs.size >= 128) throw new Error("Release completed Bash jobs before starting more.");
    if ([...this.jobs.values()].filter((job) => job.snapshot().status === "running").length >= 4) throw new Error("At most four Bash jobs may run at once.");
    const id = options?.id ?? randomUUID();
    if (this.jobs.has(id)) throw new Error("Bash job identifier already exists.");
    const job = new BashProcess(id, request, options?.beforeExecute);
    this.jobs.set(id, job);
    job.once("outputClosed", () => this.emit("outputClosed", id));
    job.once("completed", () => {
      this.pending.add(id);
      this.emit("completed", id);
    });
    return id;
  }
  private get(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Bash job not found.");
    return job;
  }
  snapshot(id: string) { return this.get(id).snapshot(); }
  wait(id: string) { return this.get(id).completion; }
  stop(id: string) { this.get(id).stop(); }
  notifications() { return [...this.pending].map((id) => this.snapshot(id)); }
  acknowledge(id: string) { this.get(id); this.pending.delete(id); }
  release(id: string) {
    const snapshot = this.snapshot(id);
    if (snapshot.status === "running" || !snapshot.outputClosed) throw new Error("Cannot release a Bash job before its process and output pipes close.");
    this.pending.delete(id);
    this.jobs.delete(id);
  }
  close() {
    this.closed = true;
    const errors: unknown[] = [];
    for (const job of this.jobs.values()) {
      try { job.stop(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Some Bash process groups could not be stopped.");
  }
}
