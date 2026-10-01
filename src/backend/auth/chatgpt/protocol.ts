import { createHash, randomBytes } from "node:crypto";
import { type ChatGPTCredential, type Credential, claims, decodeChatGPTCredential, expiry, isChatGPT, object, OAuthFailure, text } from "../credentials.js";
import type { SignInMethod } from "../sign-in.js";
import { requestToken } from "../token-endpoint.js";
import { OpenAIKeys, verifyIdToken } from "./id-token.js";

// Sign in with ChatGPT for open-source apps: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
export const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
/** The API the tokens are issued for; requests go to the public Responses API there. */
export const API_RESOURCE = "https://api.openai.com/v1";
// Asks OpenAI to register a new client for this user; the callback returns the client it issued.
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const CALLBACK_PATH = "/callback";
/** Lets the app spend the user's ChatGPT plan. */
export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
const SCOPE = `openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const AGENT_NAME = "Flame";
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/;
export const redirectUri = (port: number) => `http://127.0.0.1:${port}${CALLBACK_PATH}`;
const random = () => randomBytes(32).toString("base64url");

export type Exchange = { code: string; clientId: string; verifier: string; redirectUri: string; nonce: string; subject?: string };
export class ChatGPTTokens {
  constructor(private readonly request: typeof fetch = fetch, private readonly keys: Pick<OpenAIKeys, "key"> = new OpenAIKeys(request)) {}
  async exchange(exchange: Exchange, signal: AbortSignal): Promise<ChatGPTCredential> {
    const raw = object(await requestToken(this.request, TOKEN_URL, { grant_type: "authorization_code", client_id: exchange.clientId, code: exchange.code,
      code_verifier: exchange.verifier, redirect_uri: exchange.redirectUri, resource: API_RESOURCE }, signal));
    const idToken = text(raw.id_token);
    if (!idToken) throw new OAuthFailure("OpenAI returned an incomplete token response.");
    const identity = await verifyIdToken(idToken, { clientId: exchange.clientId, nonce: exchange.nonce, subject: exchange.subject }, this.keys, signal);
    return credential(raw, exchange.clientId, idToken, identity);
  }
  async refresh(previous: Credential, signal: AbortSignal): Promise<ChatGPTCredential> {
    if (!isChatGPT(previous)) throw new OAuthFailure("This sign-in does not belong to Sign in with ChatGPT.", true);
    const raw = object(await requestToken(this.request, TOKEN_URL, { grant_type: "refresh_token", client_id: previous.clientId,
      refresh_token: previous.refresh, resource: API_RESOURCE }, signal));
    const idToken = text(raw.id_token);
    const identity = idToken ? await verifyIdToken(idToken, { clientId: previous.clientId, subject: previous.subject }, this.keys, signal) : null;
    return credential(raw, previous.clientId, idToken ?? previous.idToken, identity, previous);
  }
}

/** The tokens OpenAI granted; refused unless they include ChatGPT plan usage. */
function credential(raw: Record<string, unknown>, clientId: string, idToken: string, identity: Record<string, unknown> | null, previous?: ChatGPTCredential, now = Date.now()) {
  const access = text(raw.access_token);
  // Refresh tokens rotate; the new one replaces the old together with the access token.
  const refresh = text(raw.refresh_token) ?? previous?.refresh;
  const subject = text(identity?.sub) ?? previous?.subject;
  const expires = expiry(raw, access ?? "", now);
  if (!access || !refresh || !subject || !Number.isSafeInteger(expires) || expires <= now) throw new OAuthFailure("OpenAI returned an incomplete token response.");
  const scopes = typeof raw.scope === "string" ? raw.scope.split(/\s+/).filter(Boolean).slice(0, 64) : previous?.scopes ?? [];
  if (!scopes.includes(PLAN_SCOPE)) throw new OAuthFailure("Flame was not allowed to use your ChatGPT plan. Sign in again and allow it.", true);
  const auth = { ...object(identity?.["https://api.openai.com/auth"]), ...object(claims(access)["https://api.openai.com/auth"]) };
  return decodeChatGPTCredential({ type: "oauth", method: "chatgpt", access, refresh, expires, clientId, subject, idToken, scopes,
    email: text(identity?.email) ?? previous?.email ?? null, plan: text(auth.chatgpt_plan_type) ?? previous?.plan ?? null });
}

/**
 * Sign in with ChatGPT. The first sign-in registers Flame for this user and workspace; signing in again while that sign-in
 * is saved reuses its registration, so the user's ChatGPT usage settings keep one entry for Flame.
 */
export function chatgptSignIn(tokens: Pick<ChatGPTTokens, "exchange" | "refresh"> = new ChatGPTTokens()): SignInMethod {
  return {
    async authorize({ previous, hostId }) {
      const saved = previous && isChatGPT(previous) ? previous : null;
      const host = await hostId();
      const state = random(), nonce = random(), verifier = random();
      let redirect: string | null = null;
      return {
        state, callback: { port: 0, path: CALLBACK_PATH },
        url(port) {
          redirect = redirectUri(port);
          const url = new URL(AUTHORIZE_URL);
          url.search = new URLSearchParams({
            client_id: saved?.clientId ?? DYNAMIC_CLIENT_ID, response_type: "code", redirect_uri: redirect, scope: SCOPE, resource: API_RESOURCE,
            state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", ext_agent_host_id: host,
            ...(saved ? { id_token_hint: saved.idToken, ...(saved.email ? { login_hint: saved.email } : {}) } : { agent_name_hint: AGENT_NAME }),
          }).toString();
          return url.href;
        },
        async complete(params, signal) {
          const issued = params.get("client_id")?.trim() || null;
          // A registration stays bound to its user and workspace; a different one in the callback is never adopted.
          if (saved && issued && issued !== saved.clientId) throw new OAuthFailure("OpenAI returned a different registration for this sign-in. Sign out, then sign in again.");
          const clientId = saved?.clientId ?? issued;
          if (!clientId || clientId === DYNAMIC_CLIENT_ID || !CLIENT_ID_PATTERN.test(clientId)) throw new OAuthFailure("OpenAI did not finish registering Flame. Try again.");
          if (!redirect) throw new OAuthFailure("The sign-in did not start. Try again.");
          return tokens.exchange({ code: params.get("code") ?? "", clientId, verifier, redirectUri: redirect, nonce, ...(saved ? { subject: saved.subject } : {}) }, signal);
        },
      };
    },
    refresh: (credential, signal) => tokens.refresh(credential, signal),
  };
}
