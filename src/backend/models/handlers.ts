import { Effect, Queue, Stream } from "effect";
import { ModelsError, ModelsRpc, type ModelsState } from "../../contracts/models.js";
import type { CodexModels } from "./service.js";

export function modelsHandlers(models: CodexModels) {
  const change = (work: () => void) => Effect.try({ try: work, catch: (error) => error instanceof ModelsError ? error
    : new ModelsError({ message: "Could not save model settings." }) });
  return ModelsRpc.toLayer({
    "codex.models.watch": () => Stream.callback<ModelsState>((queue) => Effect.acquireRelease(
      Effect.sync(() => models.watch(() => { Queue.offerUnsafe(queue, models.state); })),
      (stop) => Effect.sync(stop),
    ), { bufferSize: 1, strategy: "sliding" }),
    "codex.models.select": ({ accountKey, modelId }) => change(() => models.selectModel(accountKey, modelId)),
    "codex.models.tier": ({ accountKey, modelId, serviceTier }) => change(() => models.selectTier(accountKey, modelId, serviceTier)),
    "codex.models.thinking": ({ accountKey, modelId, effort }) => change(() => models.selectThinking(accountKey, modelId, effort)),
    "codex.models.gitText": ({ accountKey, selection }) => change(() => models.selectGitText(accountKey, selection)),
    "codex.models.refresh": () => Effect.tryPromise({ try: () => models.refresh(true),
      catch: () => new ModelsError({ message: "Could not refresh the OpenAI model catalog." }),
    }),
  });
}
