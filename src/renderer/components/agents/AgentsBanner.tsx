import "./agents-inline.css";
import { useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { SessionLocation } from "@contracts/sessions";
import { stopAgents } from "../../backend/agents";
import { rightPanel } from "./rightPanel";
import { useWorkingAgents } from "./useThreadAgents";

/** T3 Code's background-work banner: once the thread's own agent is done, its subagents still working, with View and Stop. */
export function AgentsBanner({ thread }: { thread: SessionLocation }) {
  const working = useWorkingAgents(thread), stop = useAtomSet(stopAgents, { mode: "promise" });
  const [stopping, setStopping] = useState(false), [error, setError] = useState<string | null>(null);
  if (!working) return null;
  async function stopAll() {
    setStopping(true); setError(null);
    try { await stop(thread); } catch { setError("Failed to stop background work."); } finally { setStopping(false); }
  }
  return <div className="agents-banner" role="status">
    <span className="agents-banner__dot" aria-hidden="true" />
    <span className="agents-banner__title">{working} agent{working === 1 ? "" : "s"} working</span>
    {error && <span className="agents-banner__error" role="alert">{error}</span>}
    <button type="button" aria-label="View agents" onClick={() => rightPanel.open("agents")}>View</button>
    <button type="button" disabled={stopping} onClick={() => { void stopAll(); }}>{stopping ? "Stopping..." : "Stop"}</button>
  </div>;
}
