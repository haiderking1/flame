import { randomUUID } from "node:crypto";
import type { CodexInferenceClient, InferenceRequest } from "../turns/client.js";
import { InferenceFailure } from "../turns/sse.js";
import { fitsInputBudget } from "../turns/input-budget.js";
import { estimateTokens, estimateTextTokens } from "./estimate.js";
import { serializeForSummary } from "./serialize.js";
import { SUMMARY_INSTRUCTIONS, summaryPrompt } from "./prompts.js";
import type { SummaryContent } from "./types.js";

const MAX_SUMMARY_BYTES = 64 * 1024;
const message = (content: SummaryContent) => ({ role: "user", content });

// Serialize once, then fold bounded chunks into a rolling summary. A legacy
// transcript larger than one model window never becomes an oversized request.
function chunks(content: SummaryContent, budget: number): SummaryContent[] {
  const result: SummaryContent[] = []; let current: SummaryContent = [], size = 0;
  const push = (part: SummaryContent[number]) => {
    const tokens = estimateTokens([message([part])]);
    if (tokens > budget) throw new InferenceFailure("One image exceeds the compaction input budget. Its history was preserved.");
    if (current.length && (size + tokens > budget || !fitsInputBudget([message([...current, part])]))) {
      result.push(current); current = []; size = 0;
    }
    if (!fitsInputBudget([message([part])])) throw new InferenceFailure("One attachment exceeds the compaction input budget. Its history was preserved.");
    current.push(part); size += tokens;
  };
  for (const part of content) {
    if (part.type !== "input_text" || estimateTextTokens(part.text) + 8 <= budget) { push(part); continue; }
    // Splitting serialized text never splits a replayable tool exchange: these
    // chunks are untrusted summary records, and summary requests have no tools.
    let remaining = part.text;
    const characters = Math.max(1, Math.floor((budget - 16) / 2));
    while (remaining.length) {
      let end = Math.min(characters, remaining.length);
      if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
      if (!end) end = Math.min(2, remaining.length);
      push({ type: "input_text", text: `[Conversation record continued]\n${remaining.slice(0, end)}` });
      remaining = remaining.slice(end);
    }
  }
  if (current.length) result.push(current);
  return result;
}

export async function generateSummary(client: Pick<CodexInferenceClient, "run">, request: InferenceRequest,
  prefix: readonly unknown[], contextWindow: number, signal: AbortSignal): Promise<string> {
  const reserve = Math.max(1024, Math.min(20_000, Math.floor(contextWindow * 0.2)));
  const budget = Math.floor(contextWindow * 0.75) - reserve - estimateTextTokens(SUMMARY_INSTRUCTIONS);
  if (budget < 256) throw new InferenceFailure("This model's context window is too small to compact safely.");
  const batches = chunks(serializeForSummary(prefix), budget);
  if (!batches.length) throw new InferenceFailure("There is no conversation text to compact yet.");
  let summary = "";
  for (const batch of batches) {
    signal.throwIfAborted();
    const content: SummaryContent = [
      ...(summary ? [{ type: "input_text" as const, text: `[Previous conversation summary]\n${summary}` }] : []),
      ...batch, { type: "input_text", text: summaryPrompt() },
    ];
    if (estimateTokens([message(content)]) > contextWindow * 0.9 || !fitsInputBudget([message(content)])) {
      throw new InferenceFailure("The compaction summary cannot fit this model's context window. Its history was preserved.");
    }
    const cacheKey = randomUUID();
    const result = await client.run({ ...request, sessionId: cacheKey, promptCacheKey: cacheKey,
      settings: { ...request.settings, effort: null, serviceTier: "default" },
      tools: false, fileTools: false, bashTools: false, input: [message(content)], instructionsOverride: SUMMARY_INSTRUCTIONS }, () => {}, signal);
    signal.throwIfAborted();
    if (result.output.some(raw => raw !== null && typeof raw === "object" && "type" in raw && raw.type === "function_call")) {
      throw new InferenceFailure("OpenAI returned a tool call while compacting. No tools were executed.");
    }
    summary = result.text.trim();
    if (!summary || Buffer.byteLength(summary) > MAX_SUMMARY_BYTES || estimateTextTokens(summary) > reserve) {
      throw new InferenceFailure("OpenAI returned an empty or oversized compaction summary. Its history was preserved.");
    }
  }
  return summary;
}
