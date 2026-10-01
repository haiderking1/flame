import { Schema } from "effect";
import { ImageInfo } from "./image-types.js";

// Deferred fields/statuses are retained only to render previously saved tool results accurately.
export const FileWorkDetail = Schema.Struct({
  status: Schema.Literals(["pending", "completed", "failed", "uncertain", "deferred"]),
  summary: Schema.String, output: Schema.String, truncated: Schema.Boolean, image: Schema.optionalKey(ImageInfo),
  /** The path the tool was asked about, for its file-type icon; absent when the arguments held no valid path. */
  path: Schema.optionalKey(Schema.String),
});
export type FileWorkDetail = typeof FileWorkDetail.Type;

/** A collaboration tool call: which agent it was about, and the task or message it carried. */
export const AgentWork = Schema.Struct({
  action: Schema.Literals(["spawn", "message", "followup", "wait", "interrupt", "list"]),
  target: Schema.NullOr(Schema.String), text: Schema.NullOr(Schema.String),
});
export type AgentWork = typeof AgentWork.Type;
export const WorkStep = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("message"), id: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("tool"), id: Schema.String, callId: Schema.String, name: Schema.String,
    command: Schema.String, jobId: Schema.NullOr(Schema.String), error: Schema.NullOr(Schema.String),
    file: Schema.optional(FileWorkDetail), deferred: Schema.optional(Schema.String), agent: Schema.optional(AgentWork) }),
]);
export type WorkStep = typeof WorkStep.Type;
export const WorkActivity = Schema.Struct({
  turnId: Schema.String, startedAt: Schema.Number, finishedAt: Schema.NullOr(Schema.Number),
  steps: Schema.Array(WorkStep), answer: Schema.String,
});
export type WorkActivity = typeof WorkActivity.Type;
