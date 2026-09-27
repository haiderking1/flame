import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { changeModelChoice, modelsErrorMessage, type ModelChoice } from "../../../backend/models";

export function useModelChoice(accountKey: string | null) {
  const change = useAtomSet(changeModelChoice, { mode: "promise" });
  const result = useAtomValue(changeModelChoice);
  const guard = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attemptAccount, setAttemptAccount] = useState<string | null>(null);
  async function submit(choice: ModelChoice) {
    if (guard.current) throw new Error("A model setting is already being saved.");
    guard.current = true;
    setBusy(true);
    setAttemptAccount(choice.accountKey);
    try { await change(choice); }
    finally { guard.current = false; setBusy(false); }
  }
  return { submit, busy, error: attemptAccount === accountKey ? modelsErrorMessage(result) : null };
}
