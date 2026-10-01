import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { OAuthFailure } from "./credentials.js";
import { CALLBACK_PAGE_CSP, callbackPage, type CallbackOutcome } from "./callback-page.js";

export type CallbackOptions = { port: number; path: string };
// How long the browser waits on the page for Flame to finish the sign-in before it is told to check Flame.
const FINISH_WAIT_MS = 30_000;
/**
 * Listens on 127.0.0.1 for the browser's redirect back from OpenAI. Resolves with the redirect's query once its state
 * matches and it carries a code; a denial rejects. Only the first valid redirect counts. Its page waits for `finish`,
 * so the browser shows whether the sign-in actually completed.
 */
export async function listenForCallback(state: string, signal: AbortSignal, { port, path }: CallbackOptions) {
  let resolve!: (params: URLSearchParams) => void;
  let reject!: (error: Error) => void;
  let consumed = false;
  let answer: ((outcome: CallbackOutcome) => void) | null = null;
  const params = new Promise<URLSearchParams>((yes, no) => { resolve = yes; reject = no; });
  // A cancellation may precede the caller attaching its continuation.
  void params.catch(() => {});
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", CALLBACK_PAGE_CSP);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    const show = (outcome: CallbackOutcome) => { const page = callbackPage(outcome); response.writeHead(page.status); response.end(page.html); };
    const address = server.address();
    const actualPort = address && typeof address !== "string" ? address.port : port;
    if (request.method !== "GET" || ![`localhost:${actualPort}`, `127.0.0.1:${actualPort}`].includes(request.headers.host ?? "")) {
      show("invalid"); return;
    }
    let url: URL;
    try { url = new URL(request.url ?? "/", "http://localhost"); }
    catch { show("invalid"); return; }
    if (url.pathname !== path) { show("missing"); return; }
    const supplied = Buffer.from(url.searchParams.get("state") ?? "");
    const expected = Buffer.from(state);
    if (url.searchParams.getAll("state").length !== 1 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      show("mismatch"); return;
    }
    if (consumed || signal.aborted) { show("ended"); return; }
    if (url.searchParams.has("error")) {
      consumed = true;
      show("denied");
      reject(new OAuthFailure("OpenAI sign-in was not approved. Try again.")); return;
    }
    const value = url.searchParams.get("code");
    if (!value || value.length > 4096 || url.searchParams.getAll("code").length !== 1) { show("incomplete"); return; }
    consumed = true;
    const timer = setTimeout(() => answer?.("received"), FINISH_WAIT_MS);
    answer = outcome => { clearTimeout(timer); answer = null; show(outcome); };
    resolve(url.searchParams);
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 16;
  // close() alone leaves a browser's idle spare connections attached to this server.
  const close = () => { answer?.("received"); signal.removeEventListener("abort", abort); server.close(); server.closeAllConnections(); };
  /** Tells the waiting browser whether Flame finished signing in. */
  const finish = (signedIn: boolean) => { answer?.(signedIn ? "signed-in" : "failed"); };
  const abort = () => { reject(new OAuthFailure("Sign-in cancelled or timed out. Try again.")); close(); };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
    });
  } catch {
    close();
    throw new OAuthFailure(`Cannot open the OpenAI callback on port ${port}. Close any other Codex sign-in and try again.`);
  }
  server.on("error", () => { reject(new OAuthFailure("The sign-in callback stopped. Try again.")); close(); });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const address = server.address();
  return { params, finish, close, port: address && typeof address !== "string" ? address.port : port };
}
