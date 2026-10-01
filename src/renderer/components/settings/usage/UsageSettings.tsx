import { useEffect, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import { usageAtom, refreshUsage, usageErrorMessage } from "../../../backend/usage";
import openaiLogo from "../../../assets/providers/openai.svg?no-inline";
import { ResetConfirmationDialog } from "./ResetConfirmationDialog";
import { ChatGPTPlanUsage } from "./ChatGPTPlanUsage";
import { useBankedReset } from "./useBankedReset";
import "./usage-settings.css";

function resetTime(time: number, now: number) {
  const minutes = Math.ceil(Math.max(0, time - now) / 60_000);
  if (!minutes) return "Reset time reached";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  return `Resets in ${days ? `${days}d ` : ""}${hours ? `${hours}h ` : ""}${minutes % 60}m`;
}
export function UsageSettings() {
  const result = useAtomValue(usageAtom);
  const state = Option.getOrUndefined(AsyncResult.value(result));
  const refresh = useAtomSet(refreshUsage, { mode: "promise" });
  const refreshResult = useAtomValue(refreshUsage);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const reset = useBankedReset();
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  // Account changes invalidate the backend confirmation; dismiss it here too.
  useEffect(() => { if (!state?.connected) reset.no(); }, [state?.connected]);
  const snapshot = state?.snapshot;
  const weekly = snapshot?.weekly;
  const error = usageErrorMessage(refreshResult) ?? state?.message ?? usageErrorMessage(result);
  async function update() {
    if (refreshing) return;
    setRefreshing(true);
    try { await refresh(); } catch { /* Typed failure is rendered inline. */ }
    finally { setRefreshing(false); }
  }
  return <section className="usage-settings" aria-labelledby="usage-heading">
    <h1 id="usage-heading">Usage</h1>
    {state?.managedInChatGPT ? <ChatGPTPlanUsage /> : <article className="usage-card" aria-labelledby="usage-codex-heading">
      <header className="usage-card__header"><span className="usage-card__logo"><img src={openaiLogo} alt="" /></span><h2 id="usage-codex-heading">Codex</h2>
        <button type="button" disabled={!state?.connected || refreshing} onClick={() => void update()}>Refresh</button>
      </header>
      <div className="usage-card__section">
        <div className="usage-card__line"><h3>Weekly usage</h3><span>{weekly ? `${Math.round(weekly.usedPercent)}% used` : "—"}</span></div>
        <div className="usage-meter" role="meter" aria-label="Weekly usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={weekly ? Math.min(weekly.usedPercent, 100) : undefined} aria-valuetext={weekly ? `${weekly.usedPercent}% used` : "Unavailable"}>
          <div style={{ width: `${Math.min(weekly?.usedPercent ?? 0, 100)}%` }} />
        </div>
        <p>{weekly ? <time dateTime={new Date(weekly.resetsAt).toISOString()} title={new Date(weekly.resetsAt).toLocaleString()}>{resetTime(weekly.resetsAt, now)}</time>
          : state?.connected ? "Weekly usage is not available yet." : "Sign in to OpenAI in Providers to view usage."}</p>
      </div>
      <div className="usage-card__section usage-card__banked">
        <div><h3>Banked resets</h3><p>{snapshot?.availableResets != null ? `${snapshot.availableResets} available` : "Availability not reported"}</p></div>
        <button type="button" disabled={!state?.connected || !snapshot?.canReset || reset.busy} onClick={() => void reset.open()}>Use a banked reset</button>
      </div>
      {snapshot && <p className="usage-card__updated">Last updated {new Date(snapshot.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
    </article>}
    {error && <p className="usage-settings__message" role="alert">{error}</p>}
    {reset.message && <p className="usage-settings__message" role="status">{reset.message}</p>}
    {reset.confirmation && <ResetConfirmationDialog confirmation={reset.confirmation} busy={reset.busy} onYes={() => void reset.yes()} onNo={reset.no} />}
  </section>;
}
