import { Schema } from "effect";

// Deferred fields/statuses are retained only to render previously saved tool results accurately.
export const FileWorkDetail = Schema.Struct({
  status: Schema.Literals(["pending", "completed", "failed", "uncertain", "deferred"]),
  summary: Schema.String, output: Schema.String, truncated: Schema.Boolean,
});
export type FileWorkDetail = typeof FileWorkDetail.Type;

export const WorkStep = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("message"), id: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("tool"), id: Schema.String, callId: Schema.String, name: Schema.String,
    command: Schema.String, jobId: Schema.NullOr(Schema.String), error: Schema.NullOr(Schema.String),
    file: Schema.optional(FileWorkDetail), deferred: Schema.optional(Schema.String) }),
]);
export type WorkStep = typeof WorkStep.Type;
export const WorkActivity = Schema.Struct({
  turnId: Schema.String, startedAt: Schema.Number, finishedAt: Schema.NullOr(Schema.Number),
  steps: Schema.Array(WorkStep), answer: Schema.String,
});
export type WorkActivity = typeof WorkActivity.Type;
