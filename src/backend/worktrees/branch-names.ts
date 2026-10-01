import { randomBytes } from "node:crypto";

/** Worktree branch naming ported from T3 Code, with Flame's prefix: `flame/<8 hex>` until the first message names it. */
export const WORKTREE_BRANCH_PREFIX = "flame";
const TEMPORARY = new RegExp(`^${WORKTREE_BRANCH_PREFIX}\\/[0-9a-f]{8}$`);
export const temporaryWorktreeBranch = (hex = randomBytes(4).toString("hex")) => `${WORKTREE_BRANCH_PREFIX}/${hex.toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 8)}`;
export const isTemporaryWorktreeBranch = (name: string) => TEMPORARY.test(name.trim().toLowerCase());
/** A model's suggested name as a safe `flame/…` branch. */
export function generatedWorktreeBranch(raw: string) {
  const normalized = raw.trim().toLowerCase().replace(/^refs\/heads\//, "").replace(/['"`]/g, "");
  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`) ? normalized.slice(WORKTREE_BRANCH_PREFIX.length + 1) : normalized;
  const fragment = withoutPrefix.replace(/[^a-z0-9/_-]+/g, "-").replace(/\/+/g, "/").replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "").slice(0, 64).replace(/[./_-]+$/g, "");
  return `${WORKTREE_BRANCH_PREFIX}/${fragment || "update"}`;
}
/** The name, or the first `-1` … `-100` variant that is free, as T3 Code renames worktree branches. */
export function availableBranchName(existing: readonly string[], desired: string) {
  const taken = new Set(existing);
  if (!taken.has(desired)) return desired;
  for (let suffix = 1; suffix <= 100; suffix++) if (!taken.has(`${desired}-${suffix}`)) return `${desired}-${suffix}`;
  return null;
}
