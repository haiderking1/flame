import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import { codexAuthAtom, codexAuthAction, authActionMessage, type AuthAction } from "../../backend/auth";
import "./providers-settings.css";
import { ProviderSignInRow, type SignInOption } from "./ProviderSignInRow";

const OPTIONS: readonly SignInOption[] = [{ method: "chatgpt", name: "ChatGPT", tag: "official" }, { method: "codex", name: "Codex", tag: "legacy" }];

/** The OpenAI sign-ins; Flame uses one at a time, and signing in with the other replaces it. */
export function ProvidersSettings() {
  const result = useAtomValue(codexAuthAtom);
  const state = Option.getOrUndefined(AsyncResult.value(result));
  const action = useAtomSet(codexAuthAction, { mode: "promise" });
  const actionResult = useAtomValue(codexAuthAction);
  const guard = useRef(false);
  const [busy, setBusy] = useState(false);
  const error = authActionMessage(actionResult) ?? state?.message;
  async function run(command: AuthAction) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try { await action(command); } catch { /* Typed failures are rendered below. */ }
    finally { guard.current = false; setBusy(false); }
  }
  return <section className="providers-settings" aria-labelledby="providers-heading">
    <h1 id="providers-heading">Providers</h1>
    <div className="provider-list">
      {OPTIONS.map(option => <ProviderSignInRow key={option.method} option={option} state={state} busy={busy} run={command => void run(command)} />)}
      {error && <p className="provider-auth-error" role="alert">{error}</p>}
    </div>
  </section>;
}
