import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { ImageInfo, ImageIds } from "./image-types.js";
import { WorkActivity } from "./work.js";
import { TurnStatus } from "./turn-status.js";
import { ModelSelection, ServiceTier } from "./models.js";
import { CompactionInfo, ContextInfo } from "./compaction.js";
import { SessionWorkspace } from "./session-workspace.js";

export const SessionId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
export const SessionLocation = Schema.Struct({ projectId: SessionId, sessionId: SessionId });
export type SessionLocation = typeof SessionLocation.Type;
export const fitsSessionText = (value: string) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 48 * 1024;
const Text = Schema.String.check(Schema.makeFilter(fitsSessionText));
const Revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
export const SessionSummary = Schema.Struct({
  ...SessionLocation.fields, title: Title, createdAt: Schema.Number, updatedAt: Schema.Number, revision: Revision, settledAt: Schema.NullOr(Revision),
  workspace: SessionWorkspace,
});
export type SessionSummary = typeof SessionSummary.Type;
export const SessionDocument = Schema.Struct({
  ...SessionSummary.fields, draft: Text, settings: Schema.NullOr(ModelSelection), leafId: Schema.NullOr(SessionId), context: Schema.optionalKey(ContextInfo),
});
export type SessionDocument = typeof SessionDocument.Type;
export const SessionEntry = Schema.Struct({
  id: SessionId, parentId: Schema.NullOr(SessionId), createdAt: Schema.Number, turnId: Schema.optionalKey(Schema.NullOr(SessionId)), turnStatus: Schema.optionalKey(Schema.NullOr(TurnStatus)),
  activity: Schema.optionalKey(WorkActivity), images: Schema.optionalKey(Schema.Array(ImageInfo)), requestId: Schema.optionalKey(Schema.NullOr(SessionId)),
  kind: Schema.Literals(["user", "settings", "assistant"]), text: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1024 * 1024))), settings: Schema.NullOr(ModelSelection),
});
export type SessionEntry = typeof SessionEntry.Type;
export const SessionPage = Schema.Struct({ entries: Schema.Array(SessionEntry), nextBefore: Schema.NullOr(SessionId), compactions: Schema.optionalKey(Schema.Array(CompactionInfo)) });
export type SessionPage = typeof SessionPage.Type;
export const SessionIndex = Schema.Struct({ sessions: Schema.Array(SessionSummary), warnings: Schema.Array(Schema.String) });
export class SessionError extends Schema.TaggedError<SessionError>()("SessionError", {
  code: Schema.Literals(["NOT_FOUND", "CONFLICT", "INVALID", "STORAGE"]), message: Schema.String,
}) {}
const edit = { ...SessionLocation.fields, revision: Revision };
export const SessionRpc = RpcGroup.make(
  Rpc.make("sessions.watch", { success: SessionIndex, error: SessionError, stream: true }),
  Rpc.make("sessions.create", { payload: SessionLocation, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.read", { payload: SessionLocation, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.history", { payload: { ...SessionLocation.fields, before: Schema.NullOr(SessionId) }, success: SessionPage, error: SessionError }),
  Rpc.make("sessions.draft", { payload: { ...edit, draft: Text }, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.rename", { payload: { ...edit, title: Title }, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.settle", { payload: { ...edit, settled: Schema.Boolean }, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.append", { payload: { ...edit, requestId: SessionId, text: Text, images: Schema.optionalKey(ImageIds) }, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.configure", { payload: { ...edit, accountKey: Schema.String, modelId: Schema.String,
    effort: Schema.NullOr(Schema.String), serviceTier: ServiceTier }, success: SessionDocument, error: SessionError }),
  Rpc.make("sessions.delete", { payload: edit, success: Schema.Void, error: SessionError }),
);
