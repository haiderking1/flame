const LEGACY_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CLIENT_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const LOOPBACK_CALLBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/callback$/;

/** Only OpenAI's sign-in pages, sending the browser back to Flame's loopback callback, may be opened for the backend. */
export function allowedOAuthUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    if (url.origin !== "https://auth.openai.com" || url.username || url.password || url.hash) return false;
    const client = url.searchParams.get("client_id") ?? "", redirect = url.searchParams.get("redirect_uri") ?? "";
    // The legacy Codex sign-in.
    if (url.pathname === "/oauth/authorize") return client === LEGACY_CLIENT_ID && redirect === "http://localhost:1455/auth/callback";
    // Sign in with ChatGPT, registering Flame or signing its registration in again.
    return url.pathname === "/api/accounts/authorize" && CLIENT_ID.test(client) && LOOPBACK_CALLBACK.test(redirect)
      && url.searchParams.get("resource") === "https://api.openai.com/v1";
  } catch { return false; }
}
