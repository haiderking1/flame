import { createContext, useContext, useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionLocation } from "@contracts/sessions";
import { agentsAtom, agentTeamsAtom, type AgentSummary } from "../../backend/agents";

const NONE: readonly AgentSummary[] = [];
/** The thread whose team a timeline belongs to: the thread itself, or, in an agent's transcript, the thread that started it. */
export const AgentThreadContext = createContext<SessionLocation | null>(null);
export const useAgentThread = (location: SessionLocation) => useContext(AgentThreadContext) ?? location;
/** A thread's agents, oldest first, as they change. */
export function useThreadAgents(thread: SessionLocation | null) {
  const result = useAtomValue(agentsAtom(thread ? `${thread.projectId}:${thread.sessionId}` : ""));
  return AsyncResult.isSuccess(result) ? result.value : NONE;
}
/** How many of a thread's agents are working, from the teams every thread has. */
export function useWorkingAgents(thread: SessionLocation | null) {
  const result = useAtomValue(agentTeamsAtom);
  if (!thread || !AsyncResult.isSuccess(result)) return 0;
  return result.value.find(team => team.projectId === thread.projectId && team.sessionId === thread.sessionId)?.working ?? 0;
}
/** The current time, ticking each second while `live`, for elapsed times. */
export function useNow(live: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}
