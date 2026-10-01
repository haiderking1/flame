import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionLocation } from "@contracts/sessions";
import { turnStatesAtom } from "../../backend/turns";
import { hasUnseenCompletion, runKey } from "./notificationLogic";
import { useVisitedThreads, visitedThreads } from "./visited";

/** A thread's sidebar status, as T3 Code labels it: Working while its agent runs, Completed while a finished run is unseen. */
export function useThreadStatus(location: SessionLocation) {
  const result = useAtomValue(turnStatesAtom), visited = useVisitedThreads();
  const key = runKey(location);
  const state = AsyncResult.isSuccess(result) ? result.value.find(item => runKey(item) === key) : undefined;
  const working = state?.status === "running" && state.operation === "response";
  const unseen = hasUnseenCompletion(state, visited[key]);
  return {
    label: working ? "Working" as const : unseen ? "Completed" as const : null,
    // A seen finished run can be marked unread again.
    markUnread: state?.status === "completed" && state.finishedAt !== null && !unseen ? () => visitedThreads.unread(key, state.finishedAt!) : null,
  };
}
