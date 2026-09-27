import { ModelsError } from "../../contracts/models.js";

// Modern catalogs use service_tiers; older Codex catalogs advertise additional_speed_tiers.
export function supportsFast(entry: Record<string, unknown>): boolean {
  const invalid = () => { throw new ModelsError({ message: "OpenAI returned invalid service tier metadata. Try refreshing later." }); };
  const tiers = entry.service_tiers ?? [];
  const speeds = entry.additional_speed_tiers ?? [];
  if (!Array.isArray(tiers) || tiers.length > 32 || !Array.isArray(speeds) || speeds.length > 32) return invalid();
  const ids = new Set<string>();
  for (const tier of tiers) {
    if (!tier || typeof tier !== "object" || Array.isArray(tier) || typeof tier.id !== "string"
      || !tier.id.trim() || tier.id.length > 64 || ids.has(tier.id)) return invalid();
    ids.add(tier.id);
  }
  if (speeds.some((speed) => typeof speed !== "string" || !speed.trim() || speed.length > 64)) return invalid();
  return ids.has("priority") || speeds.includes("fast");
}
