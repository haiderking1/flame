import { Cause, Effect, Queue, Stream } from "effect";
import { AgentRpc, type AgentSummary, type AgentTeamState } from "../../contracts/agents.js";
import { SessionError, type SessionLocation } from "../../contracts/sessions.js";
import { storageError } from "../sessions/files.js";
import type { AgentTeam } from "./team.js";

const failure = (error: unknown) => error instanceof SessionError ? error : storageError();
export function agentHandlers(team: AgentTeam) {
  return AgentRpc.toLayer({
    "agents.watch": thread => Stream.callback<readonly AgentSummary[], SessionError>(queue => Effect.acquireRelease(Effect.sync(() => {
      const publish = (changed: SessionLocation = thread) => {
        if (changed.projectId !== thread.projectId || changed.sessionId !== thread.sessionId) return;
        try { Queue.offerUnsafe(queue, team.summaries(thread)); }
        catch (error) { Queue.failCauseUnsafe(queue, Cause.fail(failure(error))); }
      };
      team.on("change", publish); publish();
      return () => team.off("change", publish);
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
    "agents.teams": () => Stream.callback<readonly AgentTeamState[], SessionError>(queue => Effect.acquireRelease(Effect.sync(() => {
      let last = "";
      const publish = () => {
        const teams = team.teams(), encoded = JSON.stringify(teams);
        if (encoded === last) return;
        last = encoded; Queue.offerUnsafe(queue, teams);
      };
      team.on("change", publish); publish();
      return () => team.off("change", publish);
    }), stop => Effect.sync(stop)), { bufferSize: 1, strategy: "sliding" }),
    "agents.stop": thread => Effect.try({ try: () => team.stop(thread), catch: failure }),
  });
}
