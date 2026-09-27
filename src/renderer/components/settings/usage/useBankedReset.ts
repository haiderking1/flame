import { useEffect, useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ResetConfirmation, ResetOutcome } from "@contracts/usage";
import { prepareReset, cancelReset, confirmReset, usageErrorMessage } from "../../../backend/usage";

const outcomes: Record<ResetOutcome, string> = {
  reset: "One banked reset was used.",
  nothing_to_reset: "OpenAI reported nothing to reset.",
  no_credit: "OpenAI reported no available reset.",
  already_redeemed: "This reset was already redeemed. No second request was sent.",
  unknown: "The outcome is unknown. Do not submit another reset. Check your usage on ChatGPT; Flame will not retry this request.",
};
export function useBankedReset() {
  const prepare = useAtomSet(prepareReset, { mode: "promise" });
  const cancel = useAtomSet(cancelReset, { mode: "promise" });
  const confirm = useAtomSet(confirmReset, { mode: "promise" });
  const prepareResult = useAtomValue(prepareReset);
  const confirmResult = useAtomValue(confirmReset);
  const [confirmation, setConfirmation] = useState<ResetConfirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const guard = useRef(false);
  const mounted = useRef(true);
  const active = useRef<ResetConfirmation | null>(null);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false;
    if (active.current) void cancel(active.current.id).catch(() => {});
  }; }, [cancel]);
  async function open() {
    if (guard.current || active.current) return;
    guard.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const value = await prepare();
      if (!mounted.current) { void cancel(value.id).catch(() => {}); return; }
      active.current = value;
      setConfirmation(value);
    } catch { /* Typed failure is shown below. */ }
    finally { guard.current = false; if (mounted.current) setBusy(false); }
  }
  function no() {
    if (guard.current) return;
    const value = active.current;
    active.current = null;
    setConfirmation(null);
    if (value) void cancel(value.id).catch(() => {});
  }
  async function yes() {
    const value = active.current;
    if (!value || guard.current) return;
    guard.current = true;
    setBusy(true);
    try { const outcome = await confirm(value.id); if (mounted.current) setMessage(outcomes[outcome]); }
    catch { if (mounted.current) setMessage("Could not confirm the outcome. No reset will be retried automatically. Check usage before taking further action."); }
    finally {
      active.current = null;
      guard.current = false;
      if (mounted.current) { setBusy(false); setConfirmation(null); }
    }
  }
  return { confirmation, busy, message: message ?? usageErrorMessage(confirmResult) ?? usageErrorMessage(prepareResult), open, no, yes };
}
