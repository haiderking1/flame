import { spawn } from "node:child_process";
import { GitError } from "../../contracts/git.js";

/** Removes credentials, terminal escapes and control characters from tool output before it reaches the UI or storage. */
export function safeGitMessage(text: string) {
  return text.replace(/(https?:\/\/)[^\s/]*@/g, "$1[redacted]@").replace(/([?&](?:token|access_token|key)=)[^\s&]+/gi, "$1[redacted]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g, "[redacted]")
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").trim().slice(-4000);
}
export type ProcessOptions = {
  signal?: AbortSignal; allowed?: readonly number[]; maxBytes?: number; timeout?: number;
  env?: NodeJS.ProcessEnv;
  // Receives decoded output as it arrives, for live progress such as hook output.
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
};
export type ProcessResult = { code: number; stdout: Buffer; stderr: string };
type Messages = { missing: string; failed: string; interrupted: string; deadline: string; oversized: string; exit: (code: number | null) => string };

/** Runs a tool without a shell or stdin, in its own process group, with a deadline, an output cap and cancellation. */
export function runProcess(binary: string, cwd: string, args: readonly string[], env: NodeJS.ProcessEnv, messages: Messages, options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let bytes = 0, error: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    function kill() {
      if (!child.pid) return;
      try { if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill(); } catch { /* Already exited. */ }
      killTimer ??= setTimeout(() => { try { if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* Already exited. */ } }, 1000);
    }
    const abort = () => { error = new GitError({ code: "UNAVAILABLE", message: messages.interrupted }); kill(); };
    const timer = options.timeout === Infinity ? undefined : setTimeout(() => { error = new GitError({ code: "COMMAND", message: messages.deadline }); kill(); }, options.timeout ?? 120_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    function collect(target: Buffer[], stream: "stdout" | "stderr", chunk: Buffer) {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 8 * 1024 * 1024)) { error ??= new GitError({ code: "COMMAND", message: messages.oversized }); kill(); return; }
      target.push(chunk);
      options.onOutput?.(stream, chunk.toString("utf8"));
    }
    child.stdout.on("data", chunk => collect(stdout, "stdout", chunk)); child.stderr.on("data", chunk => collect(stderr, "stderr", chunk));
    child.on("error", cause => { error = new GitError({ code: "UNAVAILABLE", message: (cause as NodeJS.ErrnoException).code === "ENOENT" ? messages.missing : messages.failed }); });
    child.on("close", code => {
      clearTimeout(timer); clearTimeout(killTimer); options.signal?.removeEventListener("abort", abort);
      if (error) { reject(error); return; }
      const detail = safeGitMessage(Buffer.concat(stderr).toString("utf8"));
      if (!(options.allowed ?? [0]).includes(code ?? -1)) { reject(new GitError({ code: "COMMAND", message: detail || messages.exit(code) })); return; }
      resolve({ code: code!, stdout: Buffer.concat(stdout), stderr: detail });
    });
  });
}
