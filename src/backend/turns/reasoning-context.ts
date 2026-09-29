import type { ModelSelection } from "../../contracts/models.js";
import { InferenceFailure } from "./sse.js";

// Request this only for the model whose persisted-reasoning support is verified.
const usesAllTurns = (modelId: string) => modelId === "gpt-6.1-sol";

export function reasoningSettings(settings: ModelSelection) {
  if (settings.effort === null && !usesAllTurns(settings.modelId)) return undefined;
  return {
    ...(settings.effort !== null ? { effort: settings.effort, summary: "auto" } : {}),
    ...(usesAllTurns(settings.modelId) ? { context: "all_turns" } : {}),
  };
}

export class ReasoningContext {
  private confirmed = false;
  private readonly required: boolean;
  constructor(modelId: string) { this.required = usesAllTurns(modelId); }

  observe(response: Record<string, unknown>, completed = false) {
    if (!this.required) return;
    const reasoning = response.reasoning;
    const context = reasoning !== null && typeof reasoning === "object" && !Array.isArray(reasoning)
      ? (reasoning as Record<string, unknown>).context : undefined;
    if (context !== undefined) {
      if (context !== "all_turns") throw new InferenceFailure("OpenAI did not enable reasoning across turns. The response was stopped and was not replayed.");
      this.confirmed = true;
    }
    // Codex may return only metadata at completion; an earlier response envelope
    // can confirm the mode, but silence must never count as confirmation.
    if (completed && !this.confirmed) throw new InferenceFailure("OpenAI did not confirm reasoning across turns. The response was stopped and was not replayed.");
  }
}
