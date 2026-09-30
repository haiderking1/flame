import { timingSafeEqual } from "node:crypto";

export function authorizedRequest(url: string, host: string | undefined, origin: string | undefined,
  port: number, token: string, allowedOrigin: string, pathname = "/rpc") {
  if (host !== `127.0.0.1:${port}` || origin !== allowedOrigin) return false;
  try {
    const parsed = new URL(url, `http://${host}`);
    const supplied = Buffer.from(parsed.searchParams.get("token") ?? ""), secret = Buffer.from(token);
    return parsed.pathname === pathname && supplied.length === secret.length && timingSafeEqual(supplied, secret);
  } catch { return false; }
}

export function authorizedImageRequest(url: string, host: string | undefined, origin: string | undefined,
  port: number, token: string, allowedOrigin: string) {
  // File HTTP requests use "null", with omitted headers attested by the main
  // process. Websocket checks remain unchanged; all requests require the secret.
  const actual = allowedOrigin === "file://" && origin === "null" ? "file://" : origin;
  return authorizedRequest(url, host, actual, port, token, allowedOrigin, "/images/upload");
}

export function imageCorsHeaders(origin: string) {
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type", "access-control-max-age": "600", vary: "Origin",
    "cache-control": "no-store", "x-content-type-options": "nosniff" };
}
