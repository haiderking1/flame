export type InferenceUsage = {
  inputTokens: number; outputTokens: number; totalTokens: number;
  cachedInputTokens: number; reasoningTokens: number;
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export function inferenceUsage(value: unknown): InferenceUsage | undefined {
  const usage = record(value);
  if (!count(usage.input_tokens) || !count(usage.output_tokens) || !count(usage.total_tokens)
    || usage.total_tokens !== usage.input_tokens + usage.output_tokens || usage.total_tokens === 0) return undefined;
  const input = record(usage.input_tokens_details), output = record(usage.output_tokens_details);
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens,
    cachedInputTokens: count(input.cached_tokens) && input.cached_tokens <= usage.input_tokens ? input.cached_tokens : 0,
    reasoningTokens: count(output.reasoning_tokens) && output.reasoning_tokens <= usage.output_tokens ? output.reasoning_tokens : 0 };
}
