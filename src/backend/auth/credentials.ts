import { Schema } from "effect";
import type { AuthMethod } from "../../contracts/auth.js";

const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32768));
const Expiry = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0));
const Profile = { email: Schema.NullOr(Schema.String), plan: Schema.NullOr(Schema.String) };
/** The legacy Codex sign-in, stored as it always was. */
export const CodexCredential = Schema.Struct({ type: Schema.Literal("oauth"), access: Token, refresh: Token, expires: Expiry, accountId: Token, ...Profile });
export type CodexCredential = typeof CodexCredential.Type;
/** Sign in with ChatGPT: the client OpenAI registered for this user, and the account it belongs to. */
export const ChatGPTCredential = Schema.Struct({
  type: Schema.Literal("oauth"), method: Schema.Literal("chatgpt"), access: Token, refresh: Token, expires: Expiry,
  clientId: Token, subject: Token, idToken: Token, scopes: Schema.Array(Schema.String).check(Schema.isMaxLength(64)), ...Profile,
});
export type ChatGPTCredential = typeof ChatGPTCredential.Type;
export const Credential = Schema.Union([ChatGPTCredential, CodexCredential]);
export type Credential = typeof Credential.Type;
export const decodeCredential = Schema.decodeUnknownSync(Credential);
export const decodeCodexCredential = Schema.decodeUnknownSync(CodexCredential);
export const decodeChatGPTCredential = Schema.decodeUnknownSync(ChatGPTCredential);
export const isChatGPT = (credential: Credential): credential is ChatGPTCredential => "method" in credential && credential.method === "chatgpt";
export const methodOf = (credential: Credential): AuthMethod => isChatGPT(credential) ? "chatgpt" : "codex";

export class OAuthFailure extends Error {
  constructor(message: string, readonly terminal = false) { super(message); }
}

/** A JWT's payload, unverified; empty when the token is not a JWT. */
export function claims(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    const value: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return object(value);
  } catch { return {}; }
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown) { return typeof value === "string" && value.length > 0 && value.length <= 32768 ? value : null; }
/** The token's lifetime from `expires_in`, or else its `exp` claim; 0 when neither is usable. */
export function expiry(response: Record<string, unknown>, access: string, now: number) {
  const exp = claims(access).exp;
  return typeof response.expires_in === "number" && response.expires_in > 0 ? now + response.expires_in * 1000 : typeof exp === "number" ? exp * 1000 : 0;
}
