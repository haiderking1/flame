import { ImageIds } from "./image-types.js";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionDocument, SessionError, SessionId, SessionLocation, fitsSessionText } from "./sessions.js";

import { WorkActivity } from "./work.js";
import { TurnStatus } from "./turn-status.js";
import { ContextInfo } from "./compaction.js";
export { TurnStatus } from "./turn-status.js";
export const TurnSnapshot = Schema.Struct({
  id: SessionId, status: TurnStatus, text: Schema.String, message: Schema.NullOr(Schema.String),
  revision: Schema.Number, entryId: Schema.NullOr(SessionId), activity: Schema.optionalKey(WorkActivity),
  operation: Schema.optionalKey(Schema.Literals(["response", "compaction"])), phase: Schema.optionalKey(Schema.Literals(["responding", "compacting"])), context: Schema.optionalKey(ContextInfo),
  // Tool results so far in this run; a queued follow-up becomes due when this grows.
  toolResults: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  // Follow-ups sent during this run, waiting for its next tool step or its end.
  queued: Schema.optionalKey(Schema.Array(SessionId)),
  // Follow-ups this run ended without delivering (it was stopped); the composer takes them back.
  returned: Schema.optionalKey(Schema.Array(SessionId)),
});
export type TurnSnapshot = typeof TurnSnapshot.Type;
/** The latest run of one session, for notifications and the sidebar's Working and Completed labels. */
export const SessionRunState = Schema.Struct({
  projectId: SessionId, sessionId: SessionId, turnId: SessionId, status: TurnStatus,
  operation: Schema.Literals(["response", "compaction"]), startedAt: Schema.Number, finishedAt: Schema.NullOr(Schema.Number),
});
export type SessionRunState = typeof SessionRunState.Type;
export const TurnRpc = RpcGroup.make(
  Rpc.make("turns.states", { success: Schema.Array(SessionRunState), error: SessionError, stream: true }),
  Rpc.make("turns.watch", { payload: SessionLocation, success: Schema.NullOr(TurnSnapshot), error: SessionError, stream: true }),
  Rpc.make("turns.start", { payload: { ...SessionLocation.fields, revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    requestId: SessionId, accountKey: Schema.String, text: Schema.String.check(Schema.makeFilter(fitsSessionText)), images: Schema.optionalKey(ImageIds) }, success: SessionDocument, error: SessionError }),
  Rpc.make("turns.stop", { payload: { ...SessionLocation.fields, turnId: SessionId }, success: Schema.Void, error: SessionError }),
  Rpc.make("turns.compact", { payload: { ...SessionLocation.fields, revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), requestId: SessionId, accountKey: Schema.String }, success: SessionDocument, error: SessionError }),
);
