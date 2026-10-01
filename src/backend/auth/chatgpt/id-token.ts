import { createPublicKey, type KeyObject, verify } from "node:crypto";
import { object, OAuthFailure, text } from "../credentials.js";
import { boundedJson } from "../token-endpoint.js";

export const ISSUER = "https://auth.openai.com";
export const JWKS_URL = "https://auth.openai.com/.well-known/jwks.json";
const KEYS_TTL_MS = 60 * 60_000;
// An unknown key ID refetches the set, but not more often than this: a forged ID cannot make Flame hammer OpenAI.
const REFETCH_MS = 30_000;
const CLOCK_SKEW_MS = 60_000;
const unverified = () => new OAuthFailure("OpenAI returned an ID token Flame could not verify. Sign in again.");

/** OpenAI's published signing keys, cached for an hour. */
export class OpenAIKeys {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private flight?: Promise<void>;
  constructor(private readonly request: typeof fetch = fetch) {}
  async key(kid: string, signal: AbortSignal): Promise<KeyObject> {
    const age = Date.now() - this.fetchedAt;
    if (!this.keys.has(kid) ? age >= REFETCH_MS : age >= KEYS_TTL_MS) await (this.flight ??= this.fetch(signal).finally(() => { this.flight = undefined; }));
    const key = this.keys.get(kid);
    if (!key) throw unverified();
    return key;
  }
  private async fetch(signal: AbortSignal) {
    let raw: unknown;
    try {
      const response = await this.request(JWKS_URL, { headers: { Accept: "application/json" }, redirect: "error", cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Unavailable"); }
      raw = await boundedJson(response, 256 * 1024, () => new Error("Oversized"));
    } catch { throw new OAuthFailure("Could not reach OpenAI to verify the sign-in. Check your connection and try again."); }
    const keys = new Map<string, KeyObject>();
    const entries = object(raw).keys;
    for (const entry of Array.isArray(entries) ? entries.slice(0, 64) : []) {
      const jwk = object(entry), kid = text(jwk.kid);
      if (!kid || jwk.kty !== "RSA" || (jwk.use !== undefined && jwk.use !== "sig") || (jwk.alg !== undefined && jwk.alg !== "RS256")) continue;
      try { keys.set(kid, createPublicKey({ key: { kty: "RSA", n: String(jwk.n), e: String(jwk.e) }, format: "jwk" })); } catch { /* Skipped. */ }
    }
    this.keys = keys;
    this.fetchedAt = Date.now();
  }
}

export type IdTokenExpectation = { clientId: string; nonce?: string; subject?: string };
const part = (value: string) => object(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
/** Verifies an ID token's signature, issuer, audience, expiry and nonce, and returns its claims. */
export async function verifyIdToken(token: string, expected: IdTokenExpectation, keys: Pick<OpenAIKeys, "key">, signal: AbortSignal, now = Date.now()) {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature || token.split(".").length !== 3) throw unverified();
  let head: Record<string, unknown>, claims: Record<string, unknown>;
  try { head = part(header); claims = part(payload); } catch { throw unverified(); }
  const kid = text(head.kid);
  if (head.alg !== "RS256" || !kid) throw unverified();
  const key = await keys.key(kid, signal);
  if (!verify("sha256", Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, "base64url"))) throw unverified();
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audience.includes(expected.clientId) || typeof claims.exp !== "number" || claims.exp * 1000 <= now - CLOCK_SKEW_MS) throw unverified();
  if (expected.nonce !== undefined && claims.nonce !== expected.nonce) throw unverified();
  const subject = text(claims.sub);
  if (!subject) throw unverified();
  if (expected.subject !== undefined && subject !== expected.subject) throw new OAuthFailure("OpenAI signed in a different account. Sign out first to switch accounts.", true);
  return { ...claims, sub: subject };
}
