import { createHash, randomBytes } from "node:crypto";
import { credentialFromResponse, OAuthFailure, type Credential } from "../credentials.js";

// Public native-client registration and callback used by OpenAI's Codex login flow.
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";

export function authorization() {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), state,
    id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "flame",
  }).toString();
  return { verifier, state, url: url.href };
}

export class CodexTokens {
  constructor(private readonly request: typeof fetch = fetch) {}
  private async token(body: Record<string, string>, signal: AbortSignal, previous?: Credential) {
    try {
      const response = await this.request(TOKEN_URL, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({ ...body, client_id: CLIENT_ID }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error",
      });
      // Bound untrusted responses and never expose the token body in errors or logs.
      const reader = response.body?.getReader();
      let length = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.length;
            if (length > 128 * 1024) { await reader.cancel(); throw new OAuthFailure("OpenAI returned an oversized token response."); }
            chunks.push(chunk.value);
          }
        } finally { reader.releaseLock(); }
      }
      let raw: unknown;
      try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { raw = null; }
      if (!response.ok) {
        const data = raw as { error?: string | { code?: string }; code?: string } | null;
        const code = typeof data?.error === "string" ? data.error : data?.error?.code ?? data?.code;
        const terminal = response.status === 401 || response.status === 403 ||
          (response.status === 400 && ["invalid_grant", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"].includes(code ?? ""));
        throw new OAuthFailure(terminal ? "Your OpenAI session is no longer valid. Sign in again." : `OpenAI authentication failed (HTTP ${response.status}). Try again later.`, terminal);
      }
      return credentialFromResponse(raw, previous);
    } catch (error) {
      if (error instanceof OAuthFailure) throw error;
      if (signal.aborted) throw new OAuthFailure("Sign-in cancelled.");
      throw new OAuthFailure("Could not reach OpenAI. Check your connection and try again.");
    }
  }
  exchange(code: string, verifier: string, signal: AbortSignal) {
    return this.token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT_URI }, signal);
  }
  refresh(credential: Credential, signal: AbortSignal) {
    return this.token({ grant_type: "refresh_token", refresh_token: credential.refresh }, signal, credential);
  }
}
