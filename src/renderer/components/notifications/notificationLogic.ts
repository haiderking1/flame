import type { SessionRunState } from "@contracts/turns";
import type { NotificationMode } from "../../lib/clientSettings";

export type ThreadEvent = { kind: "completion" | "failed"; state: SessionRunState };
export const runKey = (state: Pick<SessionRunState, "projectId" | "sessionId">) => `${state.projectId}:${state.sessionId}`;
export const eventTitle = (kind: ThreadEvent["kind"]) => kind === "completion" ? "Thread completed" : "Thread failed";
export const NOTIFICATION_MODE_LABELS: Record<NotificationMode, string> = {
  off: "Off", notifications: "Notifications only", sound: "Sound only", "notifications-and-sound": "Notifications with sound",
};
export const includesNotifications = (mode: NotificationMode) => mode === "notifications" || mode === "notifications-and-sound";
export const includesSound = (mode: NotificationMode) => mode === "sound" || mode === "notifications-and-sound";
/**
 * Threads that finished or failed since the last snapshot, as T3 Code's notification coordinator decides. The first
 * snapshot (and one after reconnecting) never replays old results; a stopped run and compaction are not alerts.
 */
export function threadEvents(previous: ReadonlyMap<string, SessionRunState> | null, states: readonly SessionRunState[]): ThreadEvent[] {
  if (!previous) return [];
  const events: ThreadEvent[] = [];
  for (const state of states) {
    const prior = previous.get(runKey(state));
    if (!prior || state.operation !== "response" || state.finishedAt === null) continue;
    if (prior.turnId === state.turnId && prior.status === state.status) continue;
    if (state.status === "completed") events.push({ kind: "completion", state });
    else if (state.status === "failed" || state.status === "interrupted") events.push({ kind: "failed", state });
  }
  return events;
}
/** A finished run the user has not looked at since; a thread never visited counts as read. */
export const hasUnseenCompletion = (state: SessionRunState | undefined, visitedAt: number | undefined) =>
  !!state && state.status === "completed" && state.finishedAt !== null && visitedAt !== undefined && state.finishedAt > visitedAt;
export const badgeText = (count: number) => count > 9 ? "9+" : String(count);
