/** Feature branch naming ported from t3code: lowercase, safe characters, a `feature/` prefix and numeric suffixes on collision. */
export function sanitizeBranchFragment(text: string) {
  const cleaned = text.toLowerCase().replace(/['"`]/g, "").replace(/^[\s./_-]+|[\s./_-]+$/g, "")
    .replace(/[^a-z0-9/_-]+/g, "-").replace(/\/+/g, "/").replace(/-+/g, "-").replace(/^[/-]+|[/-]+$/g, "").slice(0, 64).replace(/[/-]+$/g, "");
  return cleaned || "update";
}
export function sanitizeFeatureBranchName(text: string) {
  const fragment = sanitizeBranchFragment(text.replace(/^feature\//i, ""));
  return `feature/${fragment}`;
}
/** The preferred name, or the first `-2`, `-3`, … variant no existing branch uses (compared case-insensitively). */
export function uniqueBranchName(existing: readonly string[], preferred: string) {
  const taken = new Set(existing.map(name => name.toLowerCase()));
  if (!taken.has(preferred.toLowerCase())) return preferred;
  for (let suffix = 2; ; suffix++) { const candidate = `${preferred}-${suffix}`; if (!taken.has(candidate.toLowerCase())) return candidate; }
}
