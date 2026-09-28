import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { killGroup } from "./platform.js";
import { BashOutput } from "./output.js";
import type { BashRequest, BashSnapshot } from "./types.js";
import { validateBashRequest } from "./validation.js";

// The shell and its ordinary descendants form one owned process group. Commands
// must stay in the foreground of that shell, even for managed background jobs.
export class BashProcess extends EventEmitter {
  private readonly child: ChildProcess;
  private readonly output = new BashOutput();
  private status: BashSnapshot["status"] = "running";
  private exitCode: number | null = null;
  private signal: NodeJS.Signals | null = null;
  private stopRequested = false;
  private outputClosed = false;
  private error: string | null = null;
  readonly completion: Promise<BashSnapshot>;

  constructor(readonly id: string, request: BashRequest, beforeExecute?: (pid: number) => void) {
    super();
    validateBashRequest(request);
    this.child = spawn("/bin/bash", ["-c", `IFS= read -r gate || exit 125\nexec </dev/null\n${request.command}`], {
      cwd: request.cwd, env: { ...request.env }, detached: true, stdio: ["pipe", "pipe", "pipe"],
    });
    for (const stream of [this.child.stdout!, this.child.stderr!]) {
      const decoder = new StringDecoder("utf8");
      stream.on("data", (chunk: Buffer) => this.output.append(decoder.write(chunk)));
      stream.once("end", () => this.output.append(decoder.end()));
      stream.on("error", () => { this.error = "Could not read all command output."; });
    }
    this.completion = new Promise((resolve) => {
      const finish = () => {
        const snapshot = this.snapshot();
        resolve(snapshot);
        this.emit("completed", snapshot);
      };
      this.child.once("error", () => {
        if (this.status !== "running") return;
        this.status = "failed";
        this.error = "Could not start Bash. Check the shell, working directory, and permissions.";
        finish();
      });
      this.child.once("exit", (code, signal) => {
        if (this.status !== "running") return;
        this.exitCode = code;
        this.signal = signal;
        this.status = this.stopRequested && signal ? "cancelled" : "exited";
        // Do not wait for 'close': descendants can keep inherited pipes open.
        // The job owns this group; shell exit also cleans up leftover children.
        try {
          if (this.killGroup() && !this.stopRequested && !this.error) this.error = "The shell exited and remaining processes in its group were terminated. Use managed background jobs instead of daemonizing or appending &.";
        } catch { this.error = "The shell exited, but its process group could not be cleaned up."; }
        finish();
      });
    });
    this.child.stdin!.on("error", () => {});
    this.child.once("spawn", () => {
      try {
        beforeExecute?.(this.child.pid!);
        // The shell cannot pass its stdin gate until its identity is durably claimed.
        this.child.stdin!.end("start\n");
      } catch {
        this.error = "The command did not pass its durable launch gate and was not started.";
        try { this.stop(); } catch { this.error = "The command did not pass its launch gate, and process cleanup failed."; }
        finally { this.child.stdin!.destroy(); }
      }
    });
    this.child.once("close", () => {
      this.outputClosed = true;
      this.emit("outputClosed", this.snapshot());
    });
  }

  private killGroup() {
    if (!this.child.pid) return;
    return killGroup(this.child.pid);
  }

  stop() {
    if (this.status !== "running") return;
    this.killGroup();
    this.stopRequested = true;
    // Cancellation is not completion until the OS actually reports exit.
  }

  snapshot(): BashSnapshot {
    return { id: this.id, pid: this.child.pid ?? null, status: this.status, exitCode: this.exitCode,
      signal: this.signal, stopRequested: this.stopRequested, outputClosed: this.outputClosed,
      output: this.output.snapshot(), error: this.error };
  }
}
