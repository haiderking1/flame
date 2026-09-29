import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const CatalogModel = Schema.Struct({
  id: Schema.String, name: Schema.String, description: Schema.String,
  reasoningLevels: Schema.Array(Schema.Struct({ effort: Schema.String, description: Schema.String })),
  defaultReasoning: Schema.NullOr(Schema.String), supportsFast: Schema.Boolean, supportsImages: Schema.optionalKey(Schema.Boolean),
});
export type CatalogModel = typeof CatalogModel.Type;
export const ModelCatalog = Schema.Struct({
  fetchedAt: Schema.Number, etag: Schema.NullOr(Schema.String), models: Schema.Array(CatalogModel),
});
export type ModelCatalog = typeof ModelCatalog.Type;
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const ServiceTier = Schema.Literals(["default", "priority"]);
export type ServiceTier = typeof ServiceTier.Type;
export const ModelSelection = Schema.Struct({ modelId: Id, effort: Schema.NullOr(Id), serviceTier: ServiceTier });
export type ModelSelection = typeof ModelSelection.Type;
export const ModelsState = Schema.Struct({
  connected: Schema.Boolean, accountKey: Schema.NullOr(Schema.String),
  catalog: Schema.NullOr(ModelCatalog), selection: Schema.NullOr(ModelSelection), message: Schema.NullOr(Schema.String),
});
export type ModelsState = typeof ModelsState.Type;
export class ModelsError extends Schema.TaggedError<ModelsError>()("ModelsError", { message: Schema.String }) {}
export const ModelsRpc = RpcGroup.make(
  Rpc.make("codex.models.watch", { success: ModelsState, stream: true }),
  Rpc.make("codex.models.refresh", { success: Schema.Void, error: ModelsError }),
  Rpc.make("codex.models.select", { payload: { accountKey: Id, modelId: Id }, success: Schema.Void, error: ModelsError }),
  Rpc.make("codex.models.tier", { payload: { accountKey: Id, modelId: Id, serviceTier: ServiceTier }, success: Schema.Void, error: ModelsError }),
  Rpc.make("codex.models.thinking", { payload: { accountKey: Id, modelId: Id, effort: Id }, success: Schema.Void, error: ModelsError }),
);
