import type { FileDiffMetadata } from "@pierre/diffs";
/**
 * The diff renderer only draws two columns when both sides exist, so added and deleted files ignore split view.
 * Presenting them as a change keeps split view two-column (code on one side, an empty column on the other),
 * the same way a modified file with only additions or only deletions is drawn.
 */
export function splitDisplayDiff(diff: FileDiffMetadata, layout: "unified" | "split"): FileDiffMetadata {
  if (layout !== "split" || (diff.type !== "new" && diff.type !== "deleted")) return diff;
  return { ...diff, type: "change", ...(diff.cacheKey ? { cacheKey: `${diff.cacheKey}:split-${diff.type}` } : {}) };
}
