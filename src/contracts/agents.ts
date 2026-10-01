import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionError, SessionId, SessionLocation } from "./sessions.js";
import { ModelSelection } from "./models.js";

/**
 * A subagent: a hidden thread the main agent of a thread started, working in the same folder. `path` names it in its
 * team, from `/root` (the thread's own agent) down, as in `/root/review_api/tests`.
 */
export const AgentRecord = Schema.Struct({
  rootSessionId: SessionId, parentSessionId: SessionId, path: Schema.String, nickname: Schema.String,
  // What it was first asked to do.
  task: Schema.String, createdAt: Schema.Number,
});
export type AgentRecord = typeof AgentRecord.Type;
/** pending: created, its first run not started yet. idle states keep the agent available for follow-up tasks. */
export const AgentStatus = Schema.Literals(["pending", "running", "completed", "errored", "interrupted"]);
export type AgentStatus = typeof AgentStatus.Type;
export const AgentSummary = Schema.Struct({
  ...SessionLocation.fields, ...AgentRecord.fields,
  status: AgentStatus, settings: Schema.NullOr(ModelSelection),
  // Its latest final answer or error.
  result: Schema.NullOr(Schema.String),
  // The latest run: when it started and ended, and how many runs it has had.
  startedAt: Schema.NullOr(Schema.Number), finishedAt: Schema.NullOr(Schema.Number), runs: Schema.Number,
  // Its context window's estimated size, and the latest thing it did.
  tokens: Schema.NullOr(Schema.Number), activity: Schema.NullOr(Schema.String),
});
export type AgentSummary = typeof AgentSummary.Type;
/** How many of a thread's agents are working, for its sidebar row and composer. */
export const AgentTeamState = Schema.Struct({ ...SessionLocation.fields, working: Schema.Number });
export type AgentTeamState = typeof AgentTeamState.Type;
export const AgentRpc = RpcGroup.make(
  // The agents of one thread, as they change.
  Rpc.make("agents.watch", { payload: SessionLocation, success: Schema.Array(AgentSummary), error: SessionError, stream: true }),
  // Every thread with agents working.
  Rpc.make("agents.teams", { success: Schema.Array(AgentTeamState), error: SessionError, stream: true }),
  // Stops every agent of a thread.
  Rpc.make("agents.stop", { payload: SessionLocation, success: Schema.Void, error: SessionError }),
);
