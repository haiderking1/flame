import type { AuthMethod, CodexAuthState } from "@contracts/auth";
import type { AuthAction } from "../../backend/auth";
import openaiLogo from "../../assets/providers/openai.svg?no-inline";
import { ProviderConnectionStatus } from "./ProviderConnectionStatus";
import { PrivateEmail } from "./PrivateEmail";

export type SignInOption = { method: AuthMethod; name: string; tag: "official" | "legacy" };

/** One way of signing in to OpenAI; the one in use shows its status and signs out. */
export function ProviderSignInRow({ option, state, busy, run }: { option: SignInOption; state: CodexAuthState | undefined; busy: boolean; run: (action: AuthAction) => void }) {
  const { method, name } = option;
  const active = !!state && state.phase !== "disconnected" && state.method === method;
  const connected = active && state.phase === "connected";
  const signedIn = active && (state.phase === "connected" || state.phase === "expired");
  const status = !active ? null : state.phase === "authorizing" ? "Finish sign-in in your browser" : state.phase === "expired" ? "Session expired · Sign in again"
    : <>Connected{state.account?.email && <> · <PrivateEmail key={state.account.email} email={state.account.email} /></>}{state.account?.plan && <> · {state.account.plan === "prolite" ? "Pro Lite" : state.account.plan}</>}</>;
  return <article className="provider-row" data-method={method} aria-labelledby={`${method}-heading`}>
    <div className="provider-row__identity">
      <span className="provider-row__logo"><span className="provider-row__logo-mark"><img src={openaiLogo} alt="" /></span><ProviderConnectionStatus connected={connected} /></span>
      <div className="provider-row__text">
        <h2 id={`${method}-heading`}>{name} <span className="provider-row__tag" data-tag={option.tag}>{option.tag}</span></h2>
        {status && <p id={`${method}-auth-status`} aria-live="polite">{status}</p>}
      </div>
    </div>
    <div className="provider-row__actions">
      {active && state.phase === "authorizing" ? <button type="button" className="provider-row__action" disabled={busy} onClick={() => run({ type: "cancel" })}>Cancel</button>
        : signedIn ? <>
          {state.phase === "expired" && <button type="button" className="provider-row__action" disabled={busy} onClick={() => run({ type: "login", method })}>Sign in</button>}
          <button type="button" role="switch" aria-checked={connected} aria-label={`Sign out of ${name}`} title="Sign out" aria-describedby={`${method}-auth-status`}
            className="provider-row__switch" disabled={busy} onClick={() => run({ type: "logout" })}><span /></button>
        </> : <button type="button" className="provider-row__sign-in" aria-label={`Sign in with ${name}`} disabled={!state || busy || state.phase === "authorizing"}
          title={state && state.phase !== "disconnected" ? "Replaces your current sign-in" : undefined} onClick={() => run({ type: "login", method })}>Sign in</button>}
    </div>
  </article>;
}
