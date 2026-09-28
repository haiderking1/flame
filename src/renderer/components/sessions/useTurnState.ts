import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import type { SessionLocation } from "@contracts/sessions";
import { modelsAtom } from "../../backend/models";
import { turnAtom, stopTurn } from "../../backend/turns";
export function useTurnState(location: SessionLocation | null) {
  const result = useAtomValue(turnAtom(location ? `${location.projectId}:${location.sessionId}` : ""));
  const account = Option.getOrUndefined(AsyncResult.value(useAtomValue(modelsAtom)));
  const turn = Option.getOrElse(AsyncResult.value(result), () => null);
  const stop = useAtomSet(stopTurn, { mode: "promise" });
  return { accountKey: account?.accountKey ?? "", turn, running: turn?.status === "running", stop: async () => { if (location && turn) await stop({ ...location, turnId: turn.id }); } };
}
