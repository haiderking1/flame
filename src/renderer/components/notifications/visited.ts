import { useSyncExternalStore } from "react";

/** When each thread was last looked at, to mark finished runs as unseen (T3 Code's lastVisitedAt). Kept on this device. */
const KEY = "flame.sessions.visited";
const listeners = new Set<() => void>();
let cached: Record<string, number> | null = null;
function read() {
  if (cached) return cached;
  try { const value = JSON.parse(localStorage.getItem(KEY) ?? "{}"); cached = value && typeof value === "object" ? value as Record<string, number> : {}; } catch { cached = {}; }
  return cached;
}
function write(next: Record<string, number>) {
  cached = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Kept for this window. */ }
  for (const listener of listeners) listener();
}
export const visitedThreads = {
  get: read,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  /** Never moves backwards, so a run finishing later still shows as unseen. */
  visit(key: string, at: number) { const current = read(); if ((current[key] ?? -Infinity) < at) write({ ...current, [key]: at }); },
  /** Marks a finished run unseen again. */
  unread(key: string, finishedAt: number) { write({ ...read(), [key]: finishedAt - 1 }); },
  forget(key: string) { const { [key]: _removed, ...rest } = read(); write(rest); },
};
export function useVisitedThreads() { return useSyncExternalStore(visitedThreads.subscribe, visitedThreads.get); }
