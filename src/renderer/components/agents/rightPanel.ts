import { useSyncExternalStore } from "react";

/** What the right panel shows, as T3 Code's right panel surfaces: the diff, or the thread's agents (one opened, by session id). */
export type RightPanelState = { surface: "diff" | "agents" | null; agent: string | null };
let state: RightPanelState = { surface: null, agent: null };
const listeners = new Set<() => void>();
function set(next: RightPanelState) {
  if (next.surface === state.surface && next.agent === state.agent) return;
  state = next;
  for (const listener of listeners) listener();
}
export const rightPanel = {
  get: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  /** Opens a surface; for the agents, optionally straight to one agent's transcript. */
  open(surface: "diff" | "agents", agent: string | null = null) { set({ surface, agent: surface === "agents" ? agent : null }); },
  /** Closes the surface if it is open, opens it otherwise. */
  toggle(surface: "diff" | "agents") { set(state.surface === surface ? { surface: null, agent: null } : { surface, agent: null }); },
  /** Back from an agent's transcript to the list. */
  list() { set({ ...state, agent: null }); },
  close() { set({ surface: null, agent: null }); },
};
export const useRightPanel = () => useSyncExternalStore(rightPanel.subscribe, rightPanel.get);
