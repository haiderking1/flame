import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { SessionId, SessionLocation, SessionError } from "./sessions.js";
export const BashJob = Schema.Struct({
  id: SessionId, turnId: SessionId, callId: Schema.String, command: Schema.String, background: Schema.Boolean,
  status: Schema.Literals(["claimed", "running", "exited", "cancelled", "failed", "interrupted"]),
  exitCode: Schema.NullOr(Schema.Number), signal: Schema.NullOr(Schema.String),
  text: Schema.String, truncated: Schema.Boolean, outputClosed: Schema.Boolean,
  message: Schema.NullOr(Schema.String), createdAt: Schema.Number,
});
export type BashJob = typeof BashJob.Type;
export const BashRpc = RpcGroup.make(
  Rpc.make("bash.watch", { payload: SessionLocation, success: Schema.Array(BashJob), error: SessionError, stream: true }),
  Rpc.make("bash.read", { payload: { ...SessionLocation.fields, jobId: SessionId }, success: BashJob, error: SessionError }),
  Rpc.make("bash.stop", { payload: { ...SessionLocation.fields, jobId: SessionId }, success: Schema.Void, error: SessionError }),
);
