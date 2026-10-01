import { createHash, randomBytes } from "node:crypto";
import { type Credential, isChatGPT, OAuthFailure } from "../credentials.js";
import type { SignInMethod } from "../sign-in.js";
import { requestToken } from "../token-endpoint.js";
import { credentialFromResponse } from "./credential.js";

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
  async exchange(code: string, verifier: string, signal: AbortSignal) {
    return credentialFromResponse(await requestToken(this.request, TOKEN_URL,
      { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: REDIRECT_URI, client_id: CLIENT_ID }, signal));
  }
  async refresh(credential: Credential, signal: AbortSignal) {
    if (isChatGPT(credential)) throw new OAuthFailure("This sign-in does not belong to the legacy Codex sign-in.", true);
    return credentialFromResponse(await requestToken(this.request, TOKEN_URL,
      { grant_type: "refresh_token", refresh_token: credential.refresh, client_id: CLIENT_ID }, signal), credential);
  }
}

/** The legacy Codex sign-in, through the Codex CLI's registration and its fixed callback on port 1455. */
export function codexSignIn(tokens: Pick<CodexTokens, "exchange" | "refresh"> = new CodexTokens()): SignInMethod {
  return {
    async authorize() {
      const flow = authorization();
      return { state: flow.state, callback: { port: 1455, path: "/auth/callback" }, url: () => flow.url,
        complete: (params, signal) => tokens.exchange(params.get("code") ?? "", flow.verifier, signal) };
    },
    refresh: (credential, signal) => tokens.refresh(credential, signal),
  };
}
