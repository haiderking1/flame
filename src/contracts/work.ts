import { Schema } from "effect";

export const WorkStep = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("message"), id: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("tool"), id: Schema.String, callId: Schema.String, name: Schema.String,
    command: Schema.String, jobId: Schema.NullOr(Schema.String), error: Schema.NullOr(Schema.String) }),
]);
export type WorkStep = typeof WorkStep.Type;
export const WorkActivity = Schema.Struct({
  turnId: Schema.String, startedAt: Schema.Number, finishedAt: Schema.NullOr(Schema.Number),
  steps: Schema.Array(WorkStep), answer: Schema.String,
});
export type WorkActivity = typeof WorkActivity.Type;
