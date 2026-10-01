import type { GitStatus } from "@contracts/git";
import { sameGitStatus } from "./gitStatusEqual.ts";
export type GitStatusSnapshot = { readonly status: GitStatus | null; readonly pending: boolean; readonly error: string | null };
// "check": quiet, may share an in-flight read. "sync": quiet, but guaranteed to read after the call (files just changed).
// "reload": like sync, but visible as pending (explicit user refresh).
export type GitStatusRefresh = "check" | "sync" | "reload";
export type GitStatusSource = { read(projectId: string): Promise<GitStatus>; describe(error: unknown): string };
type Entry = { snapshot: GitStatusSnapshot; listeners: Set<() => void>; inflight: Promise<void> | null; queued: Promise<void> | null; loud: boolean };
const EMPTY: GitStatusSnapshot = Object.freeze({ status: null, pending: false, error: null });
// One cached status per project, shared by the Git button, Git menu and diff panel, and kept after they unmount.
export function createGitStatusStore() {
  const entries = new Map<string, Entry>();
  function entry(projectId: string) {
    let found = entries.get(projectId);
    if (!found) entries.set(projectId, found = { snapshot: EMPTY, listeners: new Set(), inflight: null, queued: null, loud: false });
    return found;
  }
  function publish(target: Entry, patch: Partial<GitStatusSnapshot>) {
    const old = target.snapshot, next = { ...old, ...patch };
    if (next.status === old.status && next.pending === old.pending && next.error === old.error) return;
    target.snapshot = next;
    for (const listener of [...target.listeners]) listener();
  }
  function start(projectId: string, target: Entry, source: GitStatusSource): Promise<void> {
    publish(target, { pending: target.loud || !target.snapshot.status });
    const flight = Promise.resolve().then(() => source.read(projectId)).then(
      status => publish(target, { status: sameGitStatus(target.snapshot.status, status) ? target.snapshot.status : status, error: null }),
      error => publish(target, { error: source.describe(error) }),
    ).then(() => {
      if (target.queued) return; // A reload requested mid-read takes over this entry.
      target.inflight = null; target.loud = false;
      publish(target, { pending: false });
    });
    target.inflight = flight;
    return flight;
  }
  return {
    snapshot(projectId: string) { return entries.get(projectId)?.snapshot ?? EMPTY; },
    subscribe(projectId: string, listener: () => void) {
      const target = entry(projectId);
      target.listeners.add(listener);
      return () => { target.listeners.delete(listener); };
    },
    refresh(projectId: string, source: GitStatusSource, mode: GitStatusRefresh): Promise<void> {
      const target = entry(projectId);
      if (mode === "reload") target.loud = true;
      if (!target.inflight) return start(projectId, target, source);
      if (mode === "check") return target.inflight;
      if (mode === "reload") publish(target, { pending: true });
      return target.queued ??= target.inflight.then(() => { target.queued = null; return start(projectId, target, source); });
    },
  };
}
export const gitStatusStore = createGitStatusStore();
