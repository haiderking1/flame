export function allowedOAuthUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try {
    const url = new URL(value);
    return url.origin === "https://auth.openai.com" && url.pathname === "/oauth/authorize" &&
      !url.username && !url.password && !url.hash &&
      url.searchParams.get("client_id") === "app_EMoamEEZ73f0CkXaXp7hrann" &&
      url.searchParams.get("redirect_uri") === "http://localhost:1455/auth/callback";
  } catch { return false; }
}
