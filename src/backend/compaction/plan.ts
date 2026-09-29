import { estimateTokens } from "./estimate.js";
import { record, type CompactionOptions, type CompactionPlan } from "./types.js";

// A response's reasoning, assistant commentary, simultaneous calls, and their
// results form one replay group. Only the next response/user starts a new group.
function boundaries(input: readonly unknown[]): number[] {
  const cuts = [0];
  const pending = new Set<string>();
  let activeResponse = false;
  for (let i = 0; i < input.length; i++) {
    const item = record(input[i]);
    const assistant = item.role === "assistant" || item.type === "function_call";
    let boundary = false;
    if (pending.size === 0) {
      if (item.role === "user") { boundary = true; activeResponse = false; }
      else if (item.type === "reasoning") {
        boundary = !activeResponse;
        activeResponse = true;
      } else if (assistant) {
        boundary = !activeResponse;
        activeResponse = true;
      }
    }
    if (boundary && i > 0) cuts.push(i);
    if (item.type === "function_call" && typeof item.call_id === "string") pending.add(item.call_id);
    if (item.type === "function_call_output") {
      if (typeof item.call_id === "string") pending.delete(item.call_id);
      if (pending.size === 0) activeResponse = false;
    }
  }
  return cuts;
}

export function planCompaction(input: readonly unknown[], options: CompactionOptions): CompactionPlan | null {
  const { contextWindow, force = false } = options;
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) throw new RangeError("Context window must be a positive safe integer.");
  if (options.keepRecentTokens !== undefined && (!Number.isSafeInteger(options.keepRecentTokens) || options.keepRecentTokens < 0)) {
    throw new RangeError("Recent context budget must be a nonnegative safe integer.");
  }
  const suffixTokens = new Array<number>(input.length + 1).fill(0);
  for (let i = input.length - 1; i >= 0; i--) suffixTokens[i] = suffixTokens[i + 1] + estimateTokens([input[i]]);
  const tokensBefore = suffixTokens[0];
  if (!force && tokensBefore < contextWindow * 0.9) return null;
  const cuts = boundaries(input);
  if (cuts.length < 2) return null;
  const budget = Math.min(options.keepRecentTokens ?? 20_000, Math.floor(contextWindow * 0.2));
  let cut = cuts[cuts.length - 1], tokens = suffixTokens[cut];
  // A requested checkpoint must remove some earlier records even when all text
  // fits the retention budget. Keep the newest complete replay group; a lone
  // user prompt still has no safe cut and returned above.
  for (let i = cuts.length - 2; i >= 1; i--) {
    const groupTokens = suffixTokens[cuts[i]] - suffixTokens[cut];
    if (tokens + groupTokens > budget) break;
    tokens += groupTokens; cut = cuts[i];
  }
  // Prefer a complete latest user span when it fits the recent-context budget.
  // Otherwise retain the latest complete response group and summarize its prefix.
  const userCuts = cuts.filter(index => index > 0 && record(input[index]).role === "user"
    && suffixTokens[index] <= budget);
  if (userCuts.length) cut = userCuts.find(index => index >= cut) ?? userCuts[userCuts.length - 1];
  if (cut <= 0) return null;
  return { prefix: input.slice(0, cut), kept: input.slice(cut), tokensBefore };
}
