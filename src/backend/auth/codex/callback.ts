import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { OAuthFailure } from "../credentials.js";

export async function listenForCode(state: string, signal: AbortSignal, port = 1455) {
  let resolve!: (code: string) => void;
  let reject!: (error: Error) => void;
  let consumed = false;
  const code = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  // A cancellation may precede the caller attaching its continuation.
  void code.catch(() => {});
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const fail = (status: number, text: string) => { response.writeHead(status); response.end(text); };
    const address = server.address();
    const actualPort = address && typeof address !== "string" ? address.port : port;
    if (request.method !== "GET" || ![`localhost:${actualPort}`, `127.0.0.1:${actualPort}`].includes(request.headers.host ?? "")) {
      fail(400, "Invalid callback request."); return;
    }
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { fail(400, "Invalid callback URL."); return; }
    if (url.pathname !== "/auth/callback") { fail(404, "Not found."); return; }
    const supplied = Buffer.from(url.searchParams.get("state") ?? "");
    const expected = Buffer.from(state);
    if (url.searchParams.getAll("state").length !== 1 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      fail(400, "Invalid sign-in state. Return to Flame and try again."); return;
    }
    if (consumed || signal.aborted) { fail(409, "This sign-in attempt is no longer active."); return; }
    if (url.searchParams.has("error")) {
      consumed = true;
      fail(400, "OpenAI sign-in was not approved. Return to Flame to try again.");
      reject(new OAuthFailure("OpenAI sign-in was not approved. Try again.")); return;
    }
    const value = url.searchParams.get("code");
    if (!value || value.length > 4096 || url.searchParams.getAll("code").length !== 1) { fail(400, "Missing or invalid authorization code."); return; }
    consumed = true;
    response.end("Authorization received. Return to Flame to check that sign-in completed. You can close this tab.");
    resolve(value);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 16;
  const close = () => { signal.removeEventListener("abort", abort); server.close(); server.closeAllConnections(); };
  const abort = () => { reject(new OAuthFailure("Sign-in cancelled or timed out. Try again.")); close(); };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
  } catch {
    close();
    throw new OAuthFailure("Cannot open the OpenAI callback on port 1455. Close any other Codex sign-in and try again.");
  }
  server.on("error", () => { reject(new OAuthFailure("The sign-in callback stopped. Try again.")); close(); });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const address = server.address();
  return { code, close, port: address && typeof address !== "string" ? address.port : port };
}
