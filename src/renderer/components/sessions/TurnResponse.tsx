import "./turn-response.css";
import type { TurnSnapshot } from "@contracts/turns";
export function TurnResponse({ turn, revision }: { turn: TurnSnapshot | null; revision: number }) {
  if (!turn) return null;
  const running = turn.status === "running";
  return <>
    {(running || turn.revision > revision || turn.revision < 0) && turn.text && <article className="session-message session-message--assistant"><span>Flame</span><p>{turn.text}</p></article>}
    {running && <p className="turn-status" role="status">{turn.text ? "Responding…" : "Thinking…"}</p>}
    {turn.message && <p className="turn-feedback" role="status">{turn.message}</p>}
  </>;
}
