import { useEffect, useRef, type RefObject } from "react";
import { useAtomSet } from "@effect/atom-react";
import { SessionError, type SessionDocument } from "@contracts/sessions";
import { compactTurn } from "../../backend/turns";
import type { TurnSnapshot } from "@contracts/turns";

export function useManualCompaction({ current, accountKey, running, turn, flushDraft, enqueue, adopt }: {
  current: RefObject<SessionDocument | null>; accountKey: string; running: boolean; turn: TurnSnapshot | null;
  flushDraft(): Promise<void>; enqueue<T>(work: () => Promise<T>): Promise<T>; adopt(document: SessionDocument): void;
}) {
  const launch = useAtomSet(compactTurn, { mode: "promise" });
  const pending = useRef<{ sessionKey: string; requestId: string } | null>(null);
  const launching = useRef(false);
  useEffect(() => {
    // A watch acknowledgement resolves an uncertain launch. Once it finishes,
    // a user retry must create new work rather than acknowledge the old failure.
    if (turn && turn.id === pending.current?.requestId) pending.current = null;
  }, [turn?.id, turn?.status]);
  return async () => {
    if (launching.current || running) return;
    const target = current.current;
    if (!target || !target.settings || !accountKey) return;
    launching.current = true;
    try {
      await flushDraft();
      return await enqueue(async () => {
        const latest = current.current;
        if (!latest || latest.projectId !== target.projectId || latest.sessionId !== target.sessionId) {
          throw new SessionError({ code: "CONFLICT", message: "Session changed before compaction could start. Open the conversation and try again." });
        }
        const sessionKey = `${latest.projectId}:${latest.sessionId}`;
        if (pending.current?.sessionKey !== sessionKey) pending.current = { sessionKey, requestId: crypto.randomUUID() };
        const saved = await launch({ projectId: latest.projectId, sessionId: latest.sessionId, revision: latest.revision, accountKey, requestId: pending.current.requestId });
        adopt(saved);
        pending.current = null;
        return saved;
      });
    } finally { launching.current = false; }
  };
}
