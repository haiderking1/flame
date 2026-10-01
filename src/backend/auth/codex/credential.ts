import { claims, type CodexCredential, decodeCodexCredential, expiry, object, OAuthFailure, text } from "../credentials.js";

// Claims are display/expiry metadata from a TLS token response, not independent proof of identity.
export function credentialFromResponse(raw: unknown, previous?: CodexCredential, now = Date.now()): CodexCredential {
  const response = object(raw);
  const access = text(response.access_token);
  const refresh = text(response.refresh_token) ?? previous?.refresh;
  if (!access || !refresh) throw new OAuthFailure("OpenAI returned an incomplete token response.");
  const accessClaims = claims(access);
  const idClaims = claims(text(response.id_token) ?? "");
  const auth = { ...object(idClaims["https://api.openai.com/auth"]), ...object(accessClaims["https://api.openai.com/auth"]) };
  const profile = object(accessClaims["https://api.openai.com/profile"]);
  const accountId = text(auth.chatgpt_account_id) ?? previous?.accountId;
  const expires = expiry(response, access, now);
  if (!accountId || !Number.isSafeInteger(expires) || expires <= now || (previous && previous.accountId !== accountId)) {
    throw new OAuthFailure("OpenAI returned invalid account or expiry information. Sign in again.");
  }
  return decodeCodexCredential({ type: "oauth", access, refresh, expires, accountId,
    email: text(idClaims.email) ?? text(profile.email) ?? previous?.email ?? null,
    plan: text(auth.chatgpt_plan_type) ?? previous?.plan ?? null,
  });
}
