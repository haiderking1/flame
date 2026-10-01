import { Effect, Schedule, Stream } from "effect";
import { Atom } from "effect/unstable/reactivity";
import type { SessionLocation } from "@contracts/sessions";
import type { AgentSummary, AgentTeamState } from "@contracts/agents";
import { Backend, backendRuntime } from "./client";

const NO_AGENTS: readonly AgentSummary[] = [];
/** The agents of one thread, keyed "projectId:sessionId". */
export const agentsAtom = Atom.family((id: string) => backendRuntime.atom(id ? Stream.unwrap(Effect.map(Backend, (client) => {
  const [projectId, sessionId] = id.split(":") as [string, string];
  return client["agents.watch"]({ projectId, sessionId }).pipe(Stream.retry(Schedule.spaced("2 seconds")));
})) : Stream.succeed(NO_AGENTS)));
/** Every thread with agents working, for the sidebar. */
export const agentTeamsAtom = backendRuntime.atom(Stream.unwrap(Effect.map(Backend, (client) =>
  client["agents.teams"]().pipe(Stream.retry(Schedule.spaced("2 seconds")))))).pipe(Atom.keepAlive);
export const stopAgents = backendRuntime.fn((thread: SessionLocation) =>
  Effect.flatMap(Backend, (client) => client["agents.stop"](thread)).pipe(Effect.timeout("10 seconds")));
export type { AgentSummary, AgentTeamState };
