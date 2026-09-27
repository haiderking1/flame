import { UsageError, type ResetOutcome, type UsageSnapshot } from "../../contracts/usage.js";

export type ResetCredit = { id: string; title: string; expiresAt: number | null };
export type UsageData = { snapshot: UsageSnapshot; credits: ResetCredit[] };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UsageError({ message: "OpenAI returned an unrecognized usage response." });
  return value as Record<string, unknown>;
}
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function parseUsage(raw: unknown, now: number): UsageSnapshot {
  const payload = object(raw);
  let weekly: UsageSnapshot["weekly"] = null;
  if (payload.rate_limit != null) {
    const limits = object(payload.rate_limit);
    for (const key of ["primary_window", "secondary_window"]) {
      if (limits[key] == null) continue;
      const window = object(limits[key]);
      // Do not label a five-hour or unknown window as weekly.
      if (window.limit_window_seconds !== 604800) continue;
      if (!number(window.used_percent) || window.used_percent < 0 || !number(window.reset_at) || window.reset_at <= 0 || window.reset_at > 8_640_000_000_000) throw new UsageError({ message: "OpenAI returned invalid weekly usage." });
      weekly = { usedPercent: window.used_percent, resetsAt: window.reset_at * 1000 };
    }
  }
  let availableResets: number | null = null;
  if (payload.rate_limit_reset_credits != null) {
    const count = object(payload.rate_limit_reset_credits).available_count;
    if (!number(count) || !Number.isSafeInteger(count) || count < 0) throw new UsageError({ message: "OpenAI returned an invalid reset count." });
    availableResets = count;
  }
  return { weekly, availableResets, fetchedAt: now, canReset: false };
}
export function parseCredits(raw: unknown, now: number): { available: number; credits: ResetCredit[] } {
  const payload = object(raw);
  if (!Array.isArray(payload.credits) || payload.credits.length > 1000 || !number(payload.available_count) || !Number.isSafeInteger(payload.available_count) || payload.available_count < 0) throw new UsageError({ message: "OpenAI returned invalid banked reset details." });
  const credits: ResetCredit[] = [];
  for (const item of payload.credits) {
    const credit = object(item);
    if (credit.status !== "available" || credit.reset_type !== "codex_rate_limits") continue;
    const expiry = credit.expires_at == null ? null : typeof credit.expires_at === "string" ? Date.parse(credit.expires_at) : NaN;
    if (expiry !== null && (!Number.isFinite(expiry) || expiry <= now)) continue;
    if (typeof credit.id !== "string" || !credit.id || credit.id.length > 256) continue;
    credits.push({ id: credit.id, title: typeof credit.title === "string" ? credit.title.slice(0, 200) : "Codex usage reset", expiresAt: expiry });
  }
  credits.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
  return { available: payload.available_count, credits };
}
export function parseOutcome(raw: unknown): ResetOutcome {
  const code = object(raw).code;
  return code === "reset" || code === "nothing_to_reset" || code === "no_credit" || code === "already_redeemed" ? code : "unknown";
}
