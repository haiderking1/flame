import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import { codexAuthAtom, codexAuthAction, authActionMessage } from "../../backend/auth";
import openaiLogo from "../../assets/providers/openai.svg?no-inline";
import "./providers-settings.css";
import { ProviderConnectionStatus } from "./ProviderConnectionStatus";
import { PrivateEmail } from "./PrivateEmail";

export function ProvidersSettings() {
  const result = useAtomValue(codexAuthAtom);
  const state = Option.getOrUndefined(AsyncResult.value(result));
  const action = useAtomSet(codexAuthAction, { mode: "promise" });
  const actionResult = useAtomValue(codexAuthAction);
  const guard = useRef(false);
  const [busy, setBusy] = useState(false);
  const connected = state?.phase === "connected";
  const authorizing = state?.phase === "authorizing";
  const signedIn = connected || state?.phase === "expired";
  const error = authActionMessage(actionResult) ?? state?.message;
  const status = authorizing ? "Finish sign-in in your browser" : connected
    ? <>Connected{state?.account?.email && <> · <PrivateEmail key={state.account.email} email={state.account.email} /></>}{state?.account?.plan && <> · {state.account.plan === "prolite" ? "Pro Lite" : state.account.plan}</>}</>
    : state?.phase === "expired" ? "Session expired · Sign in again" : "Not connected";
  async function run(command: "login" | "cancel" | "logout") {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try { await action(command); } catch { /* Typed failures are rendered below. */ }
    finally { guard.current = false; setBusy(false); }
  }
  return <section className="providers-settings" aria-labelledby="providers-heading">
    <h1 id="providers-heading">Providers</h1>
    <div className="provider-list">
      <article className="provider-row" aria-labelledby="codex-heading">
        <div className="provider-row__identity">
          <span className="provider-row__logo"><span className="provider-row__logo-mark"><img src={openaiLogo} alt="" /></span><ProviderConnectionStatus connected={connected} /></span>
          <div className="provider-row__text">
            <h2 id="codex-heading">Codex</h2>
            <p id="codex-auth-description" aria-live="polite">{status}</p>
          </div>
        </div>
        <div className="provider-row__actions">
          {authorizing ? <button type="button" className="provider-row__action" disabled={busy} onClick={() => void run("cancel")}>Cancel</button> : <>
            {state?.phase === "expired" && <button type="button" className="provider-row__action" disabled={busy} onClick={() => void run("login")}>Sign in</button>}
            <button type="button" role="switch" aria-checked={connected} aria-label={signedIn ? "Sign out of OpenAI" : "Sign in with OpenAI"} title={signedIn ? "Sign out of OpenAI" : "Sign in with OpenAI"} aria-describedby="codex-auth-description" className="provider-row__switch" disabled={!state || busy} onClick={() => void run(signedIn ? "logout" : "login")}>
              <span />
            </button>
          </>}
        </div>
      </article>
      {error && <p className="provider-auth-error" role="alert">{error}</p>}
    </div>
  </section>;
}
