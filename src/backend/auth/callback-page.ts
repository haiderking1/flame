import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** What the browser shows when OpenAI sends it back to Flame's loopback callback. */
export type CallbackOutcome = "signed-in" | "failed" | "received" | "denied" | "mismatch" | "ended" | "incomplete" | "invalid" | "missing";
type Page = { status: number; tone: "success" | "error"; title: string; message: string };
const PAGES: Record<CallbackOutcome, Page> = {
  "signed-in": { status: 200, tone: "success", title: "You're signed in", message: "You can close this tab and go back to Flame." },
  failed: { status: 200, tone: "error", title: "Flame couldn't finish signing in", message: "Go back to Flame to see what went wrong and try again." },
  received: { status: 200, tone: "success", title: "Sign-in received", message: "Go back to Flame to check that it finished. You can close this tab." },
  denied: { status: 400, tone: "error", title: "Sign-in was not approved", message: "Nothing was connected. Go back to Flame to try again." },
  mismatch: { status: 400, tone: "error", title: "This sign-in link has expired", message: "It does not belong to the sign-in Flame started. Start again from Flame." },
  ended: { status: 409, tone: "error", title: "This sign-in already finished", message: "It was completed or cancelled in Flame. Start a new one from Flame if you need to." },
  incomplete: { status: 400, tone: "error", title: "Sign-in is incomplete", message: "OpenAI did not send a sign-in code. Start again from Flame." },
  invalid: { status: 400, tone: "error", title: "Invalid sign-in request", message: "Start the sign-in from Flame." },
  missing: { status: 404, tone: "error", title: "Page not found", message: "This address only finishes a sign-in Flame started." },
};

const STYLE = `:root{color-scheme:dark;--bg:#0b0b0b;--card:#141414;--line:#ffffff12;--fg:#ededed;--muted:#9a9a9a;--ok:#4ade80;--bad:#f87171}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f4f4f5;--card:#fff;--line:#0000000f;--fg:#18181b;--muted:#6b6b72;--ok:#16a34a;--bad:#dc2626}}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;display:grid;place-items:center;padding:24px;background:radial-gradient(60rem 40rem at 50% -10%,#f9731614,transparent 60%),var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,Cantarell,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:400px;padding:40px 32px 32px;border:1px solid var(--line);border-radius:20px;background:var(--card);text-align:center;box-shadow:0 24px 64px #00000040;animation:in .35s ease-out both}
.mark{position:relative;width:72px;height:72px;margin:0 auto 22px}.mark img{width:72px;height:72px;display:block}
.badge{position:absolute;right:-4px;bottom:-4px;display:grid;place-items:center;width:26px;height:26px;border:3px solid var(--card);border-radius:50%;background:var(--ok);color:#fff}
.error .badge{background:var(--bad)}.badge svg{width:13px;height:13px}
h1{margin:0 0 8px;font-size:21px;line-height:1.3;font-weight:600;letter-spacing:-.01em;text-wrap:balance}
p{margin:0 auto;max-width:30ch;color:var(--muted);text-wrap:pretty}
@keyframes in{from{opacity:0;transform:translateY(6px) scale(.98)}}@media (prefers-reduced-motion:reduce){main{animation:none}}`;
const STYLE_HASH = createHash("sha256").update(STYLE).digest("base64");
/** Only the page's own stylesheet and its inline icon: no scripts, no requests, no framing. */
export const CALLBACK_PAGE_CSP = `default-src 'none'; style-src 'sha256-${STYLE_HASH}'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>';
const CROSS = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';

let icon: string | undefined;
// The icon is read once; the page still renders, without it, if the file is missing.
function iconData() {
  if (icon === undefined) {
    try { icon = `data:image/png;base64,${readFileSync(fileURLToPath(new URL("../../../resources/icons/flame-128.png", import.meta.url))).toString("base64")}`; }
    catch { icon = ""; }
  }
  return icon;
}
const escape = (text: string) => text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

/** The status and HTML page for a callback outcome. */
export function callbackPage(outcome: CallbackOutcome) {
  const page = PAGES[outcome], src = iconData();
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escape(page.title)} · Flame</title><style>${STYLE}</style></head>
<body><main class="${page.tone}" role="${page.tone === "error" ? "alert" : "status"}"><div class="mark">${src ? `<img src="${src}" alt="Flame">` : ""}<span class="badge">${page.tone === "success" ? CHECK : CROSS}</span></div>
<h1>${escape(page.title)}</h1><p>${escape(page.message)}</p></main></body></html>`;
  return { status: page.status, html };
}
