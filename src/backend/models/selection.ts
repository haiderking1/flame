import { ModelsError, type CatalogModel, type ModelSelection, type ServiceTier } from "../../contracts/models.js";

export function modelSelection(model: CatalogModel, preferred: string | null, serviceTier: ServiceTier = "default"): ModelSelection {
  const supports = (effort: string | null): effort is string => effort !== null && model.reasoningLevels.some((level) => level.effort === effort);
  return { modelId: model.id, effort: supports(preferred) ? preferred : supports(model.defaultReasoning) ? model.defaultReasoning : null,
    serviceTier: serviceTier === "priority" && model.supportsFast ? "priority" : "default" };
}

export function reconcileSelection(models: readonly CatalogModel[], saved: ModelSelection | null): ModelSelection | null {
  const model = models.find((model) => model.id === saved?.modelId);
  return model ? modelSelection(model, saved?.effort ?? null, saved?.serviceTier) : null;
}

export function thinkingSelection(model: CatalogModel, effort: string, serviceTier: ServiceTier = "default"): ModelSelection {
  if (!model.reasoningLevels.some((level) => level.effort === effort)) {
    throw new ModelsError({ message: "This thinking level is not supported by the selected model." });
  }
  return modelSelection(model, effort, serviceTier);
}
