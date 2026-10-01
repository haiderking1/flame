import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionRunState } from "@contracts/turns";
import { sessionsAtom } from "../../backend/sessions";
import { turnStatesAtom } from "../../backend/turns";
import { useClientSettings } from "../../lib/clientSettings";
import { useSessions } from "../sessions/SessionContext";
import { toastStore } from "../toasts/toastStore";
import { badgeText, eventTitle, includesNotifications, includesSound, runKey, threadEvents } from "./notificationLogic";
import { armNotificationSounds, playNotificationSound } from "./sounds";
import { visitedThreads } from "./visited";

const focused = () => document.visibilityState === "visible" && document.hasFocus();
const windows = navigator.platform.toLowerCase().startsWith("win");
/** Windows shows the count as an overlay image on the taskbar button; other systems draw their own badge. */
function badgeImage(count: number) {
  if (!windows || !count) return null;
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d"); if (!context) return null;
  context.fillStyle = "#e5484d"; context.beginPath(); context.arc(32, 32, 30, 0, Math.PI * 2); context.fill();
  context.fillStyle = "#fff"; context.font = "bold 34px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(badgeText(count), 32, 34);
  return canvas.toDataURL("image/png");
}
/**
 * T3 Code's thread notifications: when a thread finishes or fails, a sound if chosen; a toast with "Open thread" when
 * Flame has focus and it is another thread; otherwise a system notification, counted on the app badge until Flame is
 * focused. Also stamps the open thread as seen, for the sidebar's Completed label.
 */
export function ThreadNotifications() {
  const settings = useClientSettings();
  const sessions = useSessions();
  const statesResult = useAtomValue(turnStatesAtom), index = useAtomValue(sessionsAtom);
  const states = AsyncResult.isSuccess(statesResult) ? statesResult.value : null;
  const previous = useRef<Map<string, SessionRunState> | null>(null);
  const pending = useRef(new Set<string>());
  const latest = useRef({ settings, sessions, index }); latest.current = { settings, sessions, index };
  const open = (key: string) => {
    const [projectId, sessionId] = key.split(":") as [string, string];
    void latest.current.sessions?.open({ projectId, sessionId }).catch(() => {});
  };
  const badge = () => { const count = pending.current.size; void window.flame.setBadge?.({ count, image: badgeImage(count) }).catch(() => {}); };
  useEffect(() => { if (includesSound(settings.notificationMode)) return armNotificationSounds(); }, [settings.notificationMode]);
  useEffect(() => {
    if (!states) { previous.current = null; return; }
    const events = threadEvents(previous.current, states);
    previous.current = new Map(states.map(state => [runKey(state), state]));
    const { settings, sessions, index } = latest.current;
    for (const { kind, state } of events) {
      const key = runKey(state), title = eventTitle(kind);
      const body = (AsyncResult.isSuccess(index) ? index.value.sessions.find(session => runKey(session) === key)?.title : null) ?? "Thread";
      if (includesSound(settings.notificationMode)) playNotificationSound(kind);
      const active = sessions?.document && runKey(sessions.document) === key;
      if (settings.inAppNotifications && focused() && !active) {
        toastStore.show({ id: `thread:${key}`, scope: null, type: kind === "completion" ? "success" : "error", title, description: body, dismissAfterVisibleMs: 10_000,
          action: { label: "Open thread", run: () => open(key) } });
        continue;
      }
      if (!includesNotifications(settings.notificationMode) || focused()) continue;
      void window.flame.notify?.({ tag: key, title, body }).then(shown => { if (shown) { pending.current.add(key); badge(); } }, () => {});
    }
  }, [states]);
  // The open thread has been seen up to its latest finished run.
  const viewing = sessions?.document;
  useEffect(() => {
    if (!viewing || !states) return;
    const state = states.find(item => runKey(item) === runKey(viewing));
    visitedThreads.visit(runKey(viewing), state?.finishedAt ?? Date.now());
  }, [viewing?.projectId, viewing?.sessionId, states]);
  useEffect(() => {
    const cleared = () => { if (pending.current.size) { pending.current.clear(); badge(); } };
    const stopOpen = window.flame.onNotificationOpen?.(open), stopCleared = window.flame.onNotificationsCleared?.(cleared);
    window.addEventListener("focus", cleared);
    return () => { stopOpen?.(); stopCleared?.(); window.removeEventListener("focus", cleared); };
  }, []);
  useEffect(() => { if (settings.notificationMode === "off" && pending.current.size) { pending.current.clear(); badge(); } }, [settings.notificationMode]);
  return null;
}
