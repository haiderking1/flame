import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

export type SetupScriptResult = { exitCode: number | null; signal: NodeJS.Signals | null; error: string | null };
/**
 * Runs a project's setup script in a new worktree, in its own process group so stopping it ends everything it started.
 * The environment names both folders as T3 Code's does, under Flame's names, and turns colour off so output stays readable.
 */
export function runSetupScript(input: { command: string; worktree: string; projectRoot: string; signal: AbortSignal; onLine: (line: string) => void }): Promise<SetupScriptResult> {
  return new Promise(resolve => {
    const child = spawn("/bin/bash", ["-lc", input.command], {
      cwd: input.worktree, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FLAME_PROJECT_ROOT: input.projectRoot, FLAME_WORKTREE_PATH: input.worktree, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    let settled = false, killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* Already gone. */ } };
    const abort = () => { kill("SIGTERM"); killTimer = setTimeout(() => kill("SIGKILL"), 2000); };
    const finish = (result: SetupScriptResult) => {
      if (settled) return;
      settled = true; clearTimeout(killTimer); input.signal.removeEventListener("abort", abort);
      resolve(result);
    };
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder("utf8");
      let pending = "";
      const emit = (text: string, end = false) => {
        const parts = (pending + text).split(/\r?\n|\r/);
        pending = end ? "" : parts.pop() ?? "";
        for (const part of parts) if (part.trim()) input.onLine(part.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
      };
      stream.on("data", (chunk: Buffer) => emit(decoder.write(chunk)));
      stream.once("end", () => emit(decoder.end(), true));
    }
    child.once("error", () => finish({ exitCode: null, signal: null, error: "The setup script could not be started. Check that Bash is installed." }));
    // Prefer close, so the last lines are read; anything the script left running may hold its output open, so don't wait long.
    child.once("exit", (exitCode, signal) => {
      child.once("close", () => finish({ exitCode, signal, error: null }));
      setTimeout(() => finish({ exitCode, signal, error: null }), 500).unref();
    });
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
  });
}
