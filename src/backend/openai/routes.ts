import type { AuthMethod } from "../../contracts/auth.js";

/** What an API request needs from the signed-in account. Without a method, it is the legacy Codex sign-in. */
export type ApiCredentials = { method?: AuthMethod; access: string; accountId: string | null };
// Catalog protocol compatibility, not Flame's application version. Never used to pin model IDs.
export const CATALOG_VERSION = "0.159.0";
export const CODEX_CATALOG_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CATALOG_VERSION}`;
const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
// Sign in with ChatGPT spends the plan through the public API and must never call ChatGPT's backend.
const PUBLIC_API = "https://api.openai.com/v1";

/** True when the account signed in with ChatGPT and so uses the public API. */
export const usesPublicApi = (credentials: Pick<ApiCredentials, "method">) => credentials.method === "chatgpt";
function headers(credentials: ApiCredentials): Record<string, string> {
  if (usesPublicApi(credentials)) return { Authorization: `Bearer ${credentials.access}`, "User-Agent": "Flame" };
  return { Authorization: `Bearer ${credentials.access}`, ...(credentials.accountId ? { "ChatGPT-Account-Id": credentials.accountId } : {}),
    originator: "flame", "User-Agent": "Flame" };
}
/** Where to stream a response, and its authorization headers. */
export function responsesRoute(credentials: ApiCredentials, sessionId: string) {
  return usesPublicApi(credentials) ? { url: `${PUBLIC_API}/responses`, headers: headers(credentials) }
    : { url: CODEX_RESPONSES_URL, headers: { ...headers(credentials), "OpenAI-Beta": "responses=experimental", "session-id": sessionId } };
}
// Both catalogs leave out models newer than the client version a request names, so both name the same one.
const PUBLIC_CATALOG_URL = `${PUBLIC_API}/models?client_version=${CATALOG_VERSION}`;
/** Where to read the model catalog, and its authorization headers. */
export function modelsRoute(credentials: ApiCredentials) {
  return { url: usesPublicApi(credentials) ? PUBLIC_CATALOG_URL : CODEX_CATALOG_URL, headers: headers(credentials) };
}
