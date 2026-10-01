import { OAuthFailure } from "./credentials.js";

// Grants OpenAI will never accept again: the user has to sign in anew.
const TERMINAL_CODES = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated", "invalid_client"]);
const MAX_BYTES = 128 * 1024;

/** Reads a bounded JSON body; null when it is missing or not JSON. */
export async function boundedJson(response: Response, limit: number, oversized: () => Error): Promise<unknown> {
  const reader = response.body?.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > limit) { await reader.cancel(); throw oversized(); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

/** Posts a form to an OAuth token endpoint and returns its JSON; never exposes the body in errors or logs. */
export async function requestToken(request: typeof fetch, url: string, body: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  try {
    const response = await request(url, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body), signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), redirect: "error",
    });
    const raw = await boundedJson(response, MAX_BYTES, () => new OAuthFailure("OpenAI returned an oversized token response."));
    if (!response.ok) {
      const data = raw as { error?: string | { code?: string }; code?: string } | null;
      const code = typeof data?.error === "string" ? data.error : data?.error?.code ?? data?.code;
      const terminal = response.status === 401 || response.status === 403 || (response.status === 400 && TERMINAL_CODES.has(code ?? ""));
      throw new OAuthFailure(terminal ? "Your OpenAI session is no longer valid. Sign in again." : `OpenAI authentication failed (HTTP ${response.status}). Try again later.`, terminal);
    }
    return raw;
  } catch (error) {
    if (error instanceof OAuthFailure) throw error;
    if (signal.aborted) throw new OAuthFailure("Sign-in cancelled.");
    throw new OAuthFailure("Could not reach OpenAI. Check your connection and try again.");
  }
}
