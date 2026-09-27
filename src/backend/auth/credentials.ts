import { Schema } from "effect";

const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32768));
export const Credential = Schema.Struct({
  type: Schema.Literal("oauth"), access: Token, refresh: Token,
  expires: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0)),
  accountId: Token, email: Schema.NullOr(Schema.String), plan: Schema.NullOr(Schema.String),
});
export type Credential = typeof Credential.Type;
export const decodeCredential = Schema.decodeUnknownSync(Credential);

export class OAuthFailure extends Error {
  constructor(message: string, readonly terminal = false) { super(message); }
}

function claims(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    const value: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return object(value);
  } catch { return {}; }
}
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" && value.length > 0 && value.length <= 32768 ? value : null; }

// Claims are display/expiry metadata from a TLS token response, not independent proof of identity.
export function credentialFromResponse(raw: unknown, previous?: Credential, now = Date.now()): Credential {
  const response = object(raw);
  const access = text(response.access_token);
  const refresh = text(response.refresh_token) ?? previous?.refresh;
  if (!access || !refresh) throw new OAuthFailure("OpenAI returned an incomplete token response.");
  const accessClaims = claims(access);
  const idClaims = claims(text(response.id_token) ?? "");
  const auth = { ...object(idClaims["https://api.openai.com/auth"]), ...object(accessClaims["https://api.openai.com/auth"]) };
  const profile = object(accessClaims["https://api.openai.com/profile"]);
  const accountId = text(auth.chatgpt_account_id) ?? previous?.accountId;
  const expires = typeof response.expires_in === "number" && response.expires_in > 0
    ? now + response.expires_in * 1000 : typeof accessClaims.exp === "number" ? accessClaims.exp * 1000 : 0;
  if (!accountId || !Number.isSafeInteger(expires) || expires <= now || (previous && previous.accountId !== accountId)) {
    throw new OAuthFailure("OpenAI returned invalid account or expiry information. Sign in again.");
  }
  return decodeCredential({ type: "oauth", access, refresh, expires, accountId,
    email: text(idClaims.email) ?? text(profile.email) ?? previous?.email ?? null,
    plan: text(auth.chatgpt_plan_type) ?? previous?.plan ?? null,
  });
}
