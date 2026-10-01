import { useRef, useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ModelSelection } from "@contracts/models";
import { changeGitTextModel, modelsErrorMessage } from "../../../backend/models";

/** Saves the Git text model one change at a time; errors belong to the account they were attempted for. */
export function useGitTextModel(accountKey: string | null) {
  const change = useAtomSet(changeGitTextModel, { mode: "promise" });
  const result = useAtomValue(changeGitTextModel);
  const guard = useRef(false);
  const [busy, setBusy] = useState(false);
  const [attemptAccount, setAttemptAccount] = useState<string | null>(null);
  async function submit(selection: ModelSelection | null) {
    if (!accountKey) throw new Error("Sign in to OpenAI to choose a model.");
    if (guard.current) throw new Error("The Git text model is already being saved.");
    guard.current = true;
    setBusy(true);
    setAttemptAccount(accountKey);
    try { await change({ accountKey, selection }); }
    finally { guard.current = false; setBusy(false); }
  }
  return { submit, busy, error: attemptAccount === accountKey ? modelsErrorMessage(result) : null };
}
