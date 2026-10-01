import { useSyncExternalStore } from "react";

/** Settings that belong to this device, as T3 Code's client settings do; kept in this window's storage. */
export type ClientSettings = {
  // What sending does while the agent works: queue for its next tool step or the end of the run, or steer it at once.
  followUpBehavior: "queue" | "steer";
  // System alerts when a thread finishes or fails while Flame is in the background, and/or a sound.
  notificationMode: NotificationMode;
  // A toast when another thread finishes or fails while Flame has focus.
  inAppNotifications: boolean;
};
export type NotificationMode = "off" | "notifications" | "sound" | "notifications-and-sound";
const MODES: readonly NotificationMode[] = ["off", "notifications", "sound", "notifications-and-sound"];
export const DEFAULT_CLIENT_SETTINGS: ClientSettings = { followUpBehavior: "queue", notificationMode: "off", inAppNotifications: false };
const KEY = "flame.settings.client";
const listeners = new Set<() => void>();
let cached: ClientSettings | null = null;
function read(): ClientSettings {
  if (cached) return cached;
  let saved: Partial<ClientSettings> = {};
  try { const raw = localStorage.getItem(KEY); if (raw) saved = JSON.parse(raw) as Partial<ClientSettings>; } catch { /* Defaults. */ }
  cached = { followUpBehavior: saved.followUpBehavior === "steer" ? "steer" : "queue",
    notificationMode: MODES.includes(saved.notificationMode as NotificationMode) ? saved.notificationMode as NotificationMode : "off",
    inAppNotifications: saved.inAppNotifications === true };
  return cached;
}
export const clientSettings = {
  get: read,
  update(patch: Partial<ClientSettings>) {
    cached = { ...read(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* Applies for this window only. */ }
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
// Another window changing a setting applies here too.
window.addEventListener("storage", event => { if (event.key === KEY) { cached = null; for (const listener of listeners) listener(); } });
export function useClientSettings() { return useSyncExternalStore(clientSettings.subscribe, clientSettings.get); }
