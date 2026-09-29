import { ModelsError, type CatalogModel } from "../../contracts/models.js";

import { supportsFast } from "./service-tiers.js";

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max;
function invalid(): never { throw new ModelsError({ message: "OpenAI returned an invalid model catalog. Try refreshing later." }); }

export function parseModels(payload: unknown): readonly CatalogModel[] {
  if (!object(payload) || !Array.isArray(payload.models) || payload.models.length > 1000) return invalid();
  const seen = new Set<string>();
  const models: { priority: number; model: CatalogModel }[] = [];
  for (const entry of payload.models) {
    if (!object(entry)) return invalid();
    // Hidden and future visibility values must never become selectable by accident.
    if (entry.visibility !== "list") continue;
    if (!text(entry.slug, 256) || !text(entry.display_name, 256) || seen.has(entry.slug)
      || !Number.isSafeInteger(entry.priority) || !Array.isArray(entry.supported_reasoning_levels)
      || entry.supported_reasoning_levels.length > 32) return invalid();
    if (entry.description != null && (typeof entry.description !== "string" || entry.description.length > 4096)) return invalid();
    const efforts = new Set<string>();
    const reasoningLevels = entry.supported_reasoning_levels.map((level: unknown) => {
      if (!object(level) || !text(level.effort, 64) || typeof level.description !== "string" || level.description.length > 2048 || efforts.has(level.effort)) return invalid();
      efforts.add(level.effort);
      return { effort: level.effort, description: level.description };
    });
    if (entry.default_reasoning_level != null && !text(entry.default_reasoning_level, 64)) return invalid();
    const defaultReasoning = typeof entry.default_reasoning_level === "string" && efforts.has(entry.default_reasoning_level) ? entry.default_reasoning_level : null;
    seen.add(entry.slug);
    if (entry.context_window != null && (!Number.isSafeInteger(entry.context_window) || (entry.context_window as number) <= 0)) return invalid();
    models.push({ priority: entry.priority as number, model: { id: entry.slug, name: entry.display_name,
      description: (entry.description as string | null | undefined) ?? "", reasoningLevels, defaultReasoning, supportsFast: supportsFast(entry),
      ...(Array.isArray(entry.input_modalities) ? { supportsImages: entry.input_modalities.includes("image") } : {}),
      ...(typeof entry.context_window === "number" ? { contextWindow: entry.context_window } : {}) } });
  }
  return models.sort((a, b) => a.priority - b.priority).map(({ model }) => model);
}
