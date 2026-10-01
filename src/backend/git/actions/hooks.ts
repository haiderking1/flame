import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface HookEvents { started(name: string): void; output(text: string): void; finished(): void }
const POLL_MS = 150;
/**
 * Follows Git's trace2 event stream while a command runs, reporting which hook is executing and its latest output line.
 * Returns the extra environment for the command and a stop function that flushes remaining events and removes the file.
 */
export async function traceHooks(events: HookEvents) {
  const directory = await mkdtemp(join(tmpdir(), "flame-git-trace-"));
  const path = join(directory, "events.json");
  const running = new Map<number, string>();
  let offset = 0, partial = "", stopped = false;
  async function drain() {
    let handle;
    try { handle = await open(path, "r"); } catch { return; }
    try {
      for (;;) {
        const buffer = Buffer.alloc(64 * 1024), { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        offset += bytesRead; partial += buffer.subarray(0, bytesRead).toString("utf8");
      }
    } finally { await handle.close(); }
    const lines = partial.split("\n"); partial = lines.pop() ?? "";
    for (const line of lines) {
      let event: { event?: string; child_class?: string; hook_name?: string; child_id?: number };
      try { event = JSON.parse(line); } catch { continue; }
      if (event.event === "child_start" && event.child_class === "hook" && event.hook_name && typeof event.child_id === "number") { running.set(event.child_id, event.hook_name); events.started(event.hook_name); }
      else if (event.event === "child_exit" && typeof event.child_id === "number" && running.delete(event.child_id)) events.finished();
    }
  }
  let polling = Promise.resolve();
  const timer = setInterval(() => { polling = polling.then(drain).catch(() => {}); }, POLL_MS);
  return {
    env: { GIT_TRACE2_EVENT: path, GIT_TRACE2_EVENT_NESTING: "1" },
    // Hook output arrives on the command's own streams; only the last non-empty line is kept, as a status line.
    output(text: string) {
      const last = text.split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean).pop();
      if (!last) return;
      // Output can arrive before the next poll sees the hook start; read the trace first so it is attributed correctly.
      polling = polling.then(drain).catch(() => {}).then(() => { if (running.size) events.output(last.slice(0, 500)); });
    },
    async stop() {
      if (stopped) return; stopped = true;
      clearInterval(timer); await polling; await drain().catch(() => {});
      if (running.size) { running.clear(); events.finished(); }
      await rm(directory, { recursive: true, force: true });
    },
  };
}
