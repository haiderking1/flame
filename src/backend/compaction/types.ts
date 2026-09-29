export type CompactionPlan = { prefix: unknown[]; kept: unknown[]; tokensBefore: number };
export type CompactionOptions = { contextWindow: number; keepRecentTokens?: number; force?: boolean };
export type SummaryImage = { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" };
export type SummaryContent = ({ type: "input_text"; text: string } | SummaryImage)[];

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
