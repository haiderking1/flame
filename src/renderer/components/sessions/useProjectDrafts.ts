import { useReducer, useRef } from "react";
import { readProjectDraft, removeProjectDraft, saveProjectDraft, type ProjectDraft } from "./projectDrafts";

type DraftState = { value: ProjectDraft | null; error: string | null; dirty: boolean };
export function useProjectDrafts() {
  const cache = useRef(new Map<string, DraftState>());
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
  function save(projectId: string, value: ProjectDraft) {
    const state = get(projectId);
    if (!state.value) throw new Error(state.error!);
    state.value = value;
    try { saveProjectDraft(projectId, value); state.error = null; state.dirty = false; }
    catch (error) { state.error = error instanceof Error ? error.message : "The project draft could not be saved."; state.dirty = true; throw error; }
    finally { render(); }
  }
  function clear(projectId: string) {
    removeProjectDraft(projectId); cache.current.delete(projectId); render();
  }
  return { get, save, clear, hasUnsaved: () => [...cache.current.values()].some(state => state.dirty) };
}
