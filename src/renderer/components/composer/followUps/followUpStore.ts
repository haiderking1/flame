import type { SessionLocation } from "@contracts/sessions";
import type { FollowUp, FollowUpMode } from "./followUpLogic";

type Returned = { text: string; images: FollowUp["images"] };
const queues = new Map<string, FollowUp[]>();
const returns = new Map<string, Returned[]>();
const listeners = new Set<() => void>();
// Uploads under way, so taking a message back stops its send before it reaches the backend.
const preparing = new Map<string, AbortController>();
let version = 0;
const EMPTY: readonly FollowUp[] = [];
const changed = () => { version++; for (const listener of listeners) listener(); };
export const followUpScope = (location: SessionLocation) => `${location.projectId}:${location.sessionId}`;
/**
 * Follow-ups per session, in this window only: a queued message is a live intent, not a draft worth persisting (T3 Code).
 * Messages taken back (Cancel, Stop, or the backend returning them) wait here until that session's composer picks them up.
 */
export const followUpStore = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  version: () => version,
  list: (scope: string): readonly FollowUp[] => queues.get(scope) ?? EMPTY,
  scopes: () => [...queues.keys()],
  enqueue(scope: string, message: { text: string; images: FollowUp["images"]; mode: FollowUpMode; anchor: FollowUp["anchor"] }) {
    const item: FollowUp = { ...message, id: crypto.randomUUID(), requestId: crypto.randomUUID(), scope, hold: false, state: "waiting", createdAt: Date.now() };
    queues.set(scope, [...(queues.get(scope) ?? []), item]); changed();
    return item;
  },
  update(scope: string, id: string, patch: Partial<Pick<FollowUp, "state" | "hold" | "mode" | "requestId">>) {
    const list = queues.get(scope); if (!list?.some(item => item.id === id)) return;
    queues.set(scope, list.map(item => item.id === id ? { ...item, ...patch } : item)); changed();
  },
  /** A failed send goes back to the head, held for Send now, with a new request id so a retry is a new message. */
  fail(scope: string, id: string) {
    preparing.delete(id);
    const list = queues.get(scope) ?? [], item = list.find(entry => entry.id === id); if (!item) return;
    queues.set(scope, [{ ...item, state: "waiting", hold: true, requestId: crypto.randomUUID() }, ...list.filter(entry => entry.id !== id)]); changed();
  },
  remove(scope: string, ids: readonly string[]) {
    const list = queues.get(scope); if (!list) return;
    const rest = list.filter(item => !ids.includes(item.id));
    if (rest.length) queues.set(scope, rest); else queues.delete(scope);
    changed();
  },
  /** Marks a message as preparing; the signal aborts if it is taken back meanwhile. */
  prepare(scope: string, id: string) {
    const controller = new AbortController(); preparing.set(id, controller);
    this.update(scope, id, { state: "preparing" });
    return controller.signal;
  },
  /** Hands a message to the backend; false when it was taken back first. */
  dispatch(scope: string, id: string) {
    const controller = preparing.get(id); preparing.delete(id);
    if (!controller || controller.signal.aborted || !queues.get(scope)?.some(item => item.id === id)) return false;
    this.update(scope, id, { state: "dispatching" });
    return true;
  },
  /** Takes messages back to the composer: these, or every message the backend does not have yet. */
  giveBack(scope: string, ids?: readonly string[]) {
    const list = queues.get(scope) ?? [];
    const taken = list.filter(item => ids ? ids.includes(item.id) : item.state === "waiting" || item.state === "preparing");
    for (const item of taken) { preparing.get(item.id)?.abort(); preparing.delete(item.id); }
    if (!taken.length) return 0;
    returns.set(scope, [...(returns.get(scope) ?? []), ...taken.map(item => ({ text: item.text, images: item.images }))]);
    this.remove(scope, taken.map(item => item.id));
    return taken.length;
  },
  /** Puts a message back into this session's composer, such as after "Edit from here". */
  restore(scope: string, message: Returned) { returns.set(scope, [...(returns.get(scope) ?? []), message]); changed(); },
  /** Removes and returns messages waiting to go back into this session's composer. */
  takeReturned(scope: string) { const value = returns.get(scope) ?? []; if (value.length) { returns.delete(scope); changed(); } return value; },
  hasReturned: (scope: string) => !!returns.get(scope)?.length,
};
