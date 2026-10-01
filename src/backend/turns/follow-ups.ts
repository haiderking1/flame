import type { SessionLocation } from "../../contracts/sessions.js";

export type FollowUp = { requestId: string; text: string; images: readonly string[]; accountKey: string };
const key = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
/**
 * Messages sent while a session's agent is working (T3 Code's follow-ups). Each waits for the agent's next tool step, or
 * for the run to end, and is then delivered as the next message, one per step. Messages the run ends without delivering
 * (it was stopped, or Flame shut down) are reported as returned, so the composer can take them back. In memory only: a
 * follow-up is a live intent, not a draft worth persisting, as in T3 Code.
 */
export class FollowUps {
  private readonly waiting = new Map<string, FollowUp[]>();
  private readonly returned = new Map<string, { turnId: string; requestIds: string[] }>();
  hold(location: SessionLocation, followUp: FollowUp) {
    const list = this.waiting.get(key(location)) ?? [];
    if (!list.some(item => item.requestId === followUp.requestId)) this.waiting.set(key(location), [...list, followUp]);
  }
  holds(location: SessionLocation, requestId: string) { return !!this.waiting.get(key(location))?.some(item => item.requestId === requestId); }
  has(location: SessionLocation) { return !!this.waiting.get(key(location))?.length; }
  /** Request ids still waiting, in order. */
  queued(location: SessionLocation) { return this.waiting.get(key(location))?.map(item => item.requestId) ?? []; }
  /** Takes the next message to deliver. */
  next(location: SessionLocation) {
    const [first, ...rest] = this.waiting.get(key(location)) ?? [];
    if (rest.length) this.waiting.set(key(location), rest); else this.waiting.delete(key(location));
    return first ?? null;
  }
  /** Gives every waiting message back when the run `turnId` ends without them; returns how many. */
  release(location: SessionLocation, turnId: string, extra: readonly string[] = []) {
    const ids = [...extra, ...this.queued(location)];
    this.waiting.delete(key(location));
    if (ids.length) this.returned.set(key(location), { turnId, requestIds: ids });
    return ids.length;
  }
  /** Messages given back by the run `turnId`, for its snapshot. */
  returnedBy(location: SessionLocation, turnId: string) {
    const entry = this.returned.get(key(location));
    return entry?.turnId === turnId ? entry.requestIds : [];
  }
}
