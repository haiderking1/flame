import type { TurnSnapshot } from "@contracts/turns";

export type FollowUpMode = "queue" | "steer";
// Preparing (uploading) can still be taken back; dispatching and sent are with the backend.
export type FollowUpState = "waiting" | "preparing" | "dispatching" | "sent";
/** A message written while the agent works (T3 Code's queued follow-up), until the backend delivers or returns it. */
export type FollowUp = {
  id: string; requestId: string; scope: string; text: string; images: readonly { id: string; name: string; file: Blob }[];
  mode: FollowUpMode;
  // The run and its tool results when the message was queued: in Queue mode it waits for the next tool step after this.
  anchor: { turnId: string | null; toolResults: number };
  // Set after a failed send: it waits for Send now instead of going on its own.
  hold: boolean;
  state: FollowUpState; createdAt: number;
};
type Turn = Pick<TurnSnapshot, "id" | "status" | "toolResults" | "returned"> | null;
export const anchorOf = (turn: Turn) => ({ turnId: turn?.status === "running" ? turn.id : null, toolResults: turn?.status === "running" ? turn.toolResults ?? 0 : 0 });
/**
 * Whether a waiting message should go now, as T3 Code decides: a steer goes at once; a queued one once the run is over,
 * a new run has started, or a tool step finished since it was queued. Held messages wait for Send now.
 */
export function isDue(message: FollowUp, turn: Turn) {
  if (message.hold || message.state !== "waiting") return false;
  if (message.mode === "steer") return true;
  if (!turn || turn.status !== "running" || turn.id !== message.anchor.turnId) return true;
  return (turn.toolResults ?? 0) > message.anchor.toolResults;
}
/** The one message to send next: messages leave in order, one at a time, and a held head holds the rest. */
export function nextDue(messages: readonly FollowUp[], turn: Turn) {
  if (messages.some(message => message.state === "preparing" || message.state === "dispatching")) return null;
  const head = messages.find(message => message.state === "waiting");
  return head && isDue(head, turn) ? head : null;
}
/** Sent messages the backend has now delivered (started as a run) or given back (the run was stopped). */
export function settled(messages: readonly FollowUp[], turn: Turn) {
  const delivered: FollowUp[] = [], returned: FollowUp[] = [];
  for (const message of messages) {
    if (message.state !== "sent" || !turn) continue;
    if (turn.id === message.requestId) delivered.push(message);
    else if (turn.returned?.includes(message.requestId)) returned.push(message);
  }
  return { delivered, returned };
}
/** Follow-up behaviour for one message: Ctrl/Cmd+Enter does the opposite of the setting. */
export const intentFor = (setting: FollowUpMode, alternate: boolean): FollowUpMode => alternate ? setting === "queue" ? "steer" : "queue" : setting;
export function statusLabel(message: FollowUp, head: boolean) {
  if (message.state !== "waiting") return "Sending to the agent";
  if (message.hold) return "Waits for Send now";
  if (message.mode === "steer") return "Sends at the agent's next tool step";
  return head ? "Sends after the next tool call or when the turn ends" : "Sends after the messages above it";
}
