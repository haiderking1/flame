import { useEffect, useReducer, useRef } from "react";
import { readProjectDraft, removeProjectDraft, saveProjectDraft, type ProjectDraft } from "./projectDrafts";
type DraftState = { value: ProjectDraft | null; error: string | null; dirty: boolean };
export function useProjectDrafts() {
  const cache = useRef(new Map<string, DraftState>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, render] = useReducer(value => value + 1, 0);
  function get(projectId: string): DraftState {
    let state = cache.current.get(projectId);
    if (!state) {
      try { state = { value: readProjectDraft(projectId), error: null, dirty: false }; }
      catch { state = { value: null, error: "The saved project draft could not be read. Check browser storage, then restart Flame. It has not been overwritten.", dirty: false }; }
      cache.current.set(projectId, state);
    }
    return state;
  }
  function flush(projectId: string) {
    clearTimeout(timers.current.get(projectId)); timers.current.delete(projectId);
    const state = get(projectId);
    if (!state.value) throw new Error(state.error!);
    if (!state.dirty) return;
    try { saveProjectDraft(projectId, state.value); state.error = null; state.dirty = false; }
    catch (error) { state.error = error instanceof Error ? error.message : "The project draft could not be saved."; state.dirty = true; throw error; }
    finally { render(); }
  }
  // Request identities and accepted-message markers require immediate durability.
  function save(projectId: string, value: ProjectDraft) {
    const state = get(projectId); if (!state.value) throw new Error(state.error!);
    state.value = value; state.dirty = true; flush(projectId);
  }
  function update(projectId: string, value: ProjectDraft) {
    const state = get(projectId); if (!state.value) return;
    state.value = value; state.dirty = true; render();
    clearTimeout(timers.current.get(projectId));
    timers.current.set(projectId, setTimeout(() => { try { flush(projectId); } catch { /* The retained state exposes the failure to the composer. */ } }, 400));
  }
  function flushAll() { for (const [id, state] of cache.current) if (state.dirty) flush(id); }
  function clear(projectId: string) { removeProjectDraft(projectId); clearTimeout(timers.current.get(projectId)); timers.current.delete(projectId); cache.current.delete(projectId); render(); }
  useEffect(() => {
    const flushQuietly = () => { try { flushAll(); } catch { /* Closing is guarded by the workspace; forced termination cannot be made durable. */ } };
    const visibility = () => { if (document.visibilityState === "hidden") flushQuietly(); };
    window.addEventListener("pagehide", flushQuietly); document.addEventListener("visibilitychange", visibility);
    return () => { flushQuietly(); for (const timer of timers.current.values()) clearTimeout(timer); window.removeEventListener("pagehide", flushQuietly); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return { get, save, update, clear, flush, flushAll, hasUnsaved: () => [...cache.current.values()].some(state => state.dirty) };
}
