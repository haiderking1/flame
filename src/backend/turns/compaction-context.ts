import type { SessionLocation } from "../../contracts/sessions.js";
import type { ModelSelection } from "../../contracts/models.js";
import type { Sessions } from "../sessions/service.js";
import type { CodexModels } from "../models/service.js";
import type { CodexInferenceClient, InferenceRequest } from "./client.js";
import { CompactionRuntime } from "../compaction/runtime.js";
import { estimateTokens } from "../compaction/estimate.js";

export function turnContext(sessions: Sessions, models: Partial<Pick<CodexModels, "contextWindow">>,
  client: Pick<CodexInferenceClient, "run">, location: SessionLocation & { requestId: string },
  settings: ModelSelection, request: InferenceRequest, signal: AbortSignal, manual: boolean,
  accountKey: string, outputCount: () => number, ledger: () => unknown[], publish: () => void) {
  const snapshot = sessions.compactions(location, store => store.capture(settings, accountKey));
  let previousId = snapshot.checkpointId;
  const window = models.contextWindow?.(accountKey, settings.modelId) ?? 128_000;
  const runtime = new CompactionRuntime(client, request, snapshot.input, window, 0, {
    ledger,
    save(summary, kept, tokensBefore, tokensAfter, trigger) {
      signal.throwIfAborted();
      const saved = sessions.compactions(location, store => store.save({ expectedLeafId: snapshot.leafId,
        previousId, ...(manual ? {} : { turnId: location.requestId, outputCount: outputCount() }),
        summary, kept, modelId: settings.modelId, accountKey, tokensBefore, tokensAfter, trigger }));
      previousId = saved.id;
    },
    phase(phase, info) {
      signal.throwIfAborted();
      sessions.turns(location, store => store.phase(location.requestId, phase, info, estimateTokens(ledger()), runtime.overheadTokens())); publish();
    },
  }, signal, snapshot.compactionCount, snapshot.lastCompactedAt);
  if (snapshot.tokenAnchor) runtime.restoreAnchor(snapshot.tokenAnchor);
  return runtime;
}
