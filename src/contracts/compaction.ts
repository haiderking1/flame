import { Schema } from "effect";

const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Id = Schema.String.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
export const ContextInfo = Schema.Struct({
  estimatedTokens: Count, contextWindow: Count, thresholdTokens: Count,
  compactionCount: Count, lastCompactedAt: Schema.NullOr(Schema.Number),
});
export type ContextInfo = typeof ContextInfo.Type;
export const CompactionInfo = Schema.Struct({
  id: Id, createdAt: Schema.Number, leafId: Schema.NullOr(Id), summary: Schema.String,
  modelId: Schema.String, tokensBefore: Count, tokensAfter: Count,
  trigger: Schema.Literals(["auto", "manual", "overflow"]),
});
export type CompactionInfo = typeof CompactionInfo.Type;
export const CompactionMetadata = CompactionInfo;
export type CompactionMetadata = CompactionInfo;
