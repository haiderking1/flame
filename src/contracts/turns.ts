import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionDocument, SessionError, SessionId, SessionLocation, fitsSessionText } from "./sessions.js";

import { WorkActivity } from "./work.js";
import { TurnStatus } from "./turn-status.js";
export { TurnStatus } from "./turn-status.js";
export const TurnSnapshot = Schema.Struct({
  id: SessionId, status: TurnStatus, text: Schema.String, message: Schema.NullOr(Schema.String),
  revision: Schema.Number, entryId: Schema.NullOr(SessionId), activity: Schema.optionalKey(WorkActivity),
});
export type TurnSnapshot = typeof TurnSnapshot.Type;
export const TurnRpc = RpcGroup.make(
  Rpc.make("turns.watch", { payload: SessionLocation, success: Schema.NullOr(TurnSnapshot), error: SessionError, stream: true }),
  Rpc.make("turns.start", { payload: { ...SessionLocation.fields, revision: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    requestId: SessionId, accountKey: Schema.String, text: Schema.String.check(Schema.makeFilter(fitsSessionText)) }, success: SessionDocument, error: SessionError }),
  Rpc.make("turns.stop", { payload: { ...SessionLocation.fields, turnId: SessionId }, success: Schema.Void, error: SessionError }),
);
