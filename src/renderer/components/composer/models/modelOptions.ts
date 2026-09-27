export type ModelOption = { id: string; name: string; description?: string };

// Display grouping requested for these families; availability still comes from the live catalog.
export function isLegacyModel(model: ModelOption): boolean {
  const family = /^gpt[-\s]?5\.(?:5|6)(?=$|[-\s])/i;
  return family.test(model.id) || family.test(model.name);
}

export function filterModels(models: readonly ModelOption[], query: string): readonly ModelOption[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((model) => {
    const text = `${model.name} ${model.id} ${model.description ?? ""}`.toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  });
}
