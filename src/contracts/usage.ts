import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const UsageSnapshot = Schema.Struct({
  fetchedAt: Schema.Number,
  weekly: Schema.NullOr(Schema.Struct({ usedPercent: Schema.Number, resetsAt: Schema.Number })),
  availableResets: Schema.NullOr(Schema.Number),
  canReset: Schema.Boolean,
});
export type UsageSnapshot = typeof UsageSnapshot.Type;
export const UsageState = Schema.Struct({ connected: Schema.Boolean, snapshot: Schema.NullOr(UsageSnapshot), message: Schema.NullOr(Schema.String) });
export type UsageState = typeof UsageState.Type;
export const ResetConfirmation = Schema.Struct({ id: Id, title: Schema.String, expiresAt: Schema.Number });
export type ResetConfirmation = typeof ResetConfirmation.Type;
export const ResetOutcome = Schema.Literals(["reset", "nothing_to_reset", "no_credit", "already_redeemed", "unknown"]);
export type ResetOutcome = typeof ResetOutcome.Type;
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", { message: Schema.String }) {}
export const UsageRpc = RpcGroup.make(
  Rpc.make("codex.usage.watch", { success: UsageState, error: UsageError, stream: true }),
  Rpc.make("codex.usage.refresh", { success: Schema.Void, error: UsageError }),
  Rpc.make("codex.reset.prepare", { success: ResetConfirmation, error: UsageError }),
  Rpc.make("codex.reset.cancel", { payload: { id: Id }, success: Schema.Void, error: UsageError }),
  Rpc.make("codex.reset.confirm", { payload: { id: Id }, success: ResetOutcome, error: UsageError }),
);
