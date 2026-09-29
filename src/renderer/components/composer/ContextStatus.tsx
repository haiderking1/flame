import { useSessions } from "../sessions/SessionContext";
import "./context-status.css";

const number = new Intl.NumberFormat();
export function ContextStatus() {
  const sessions = useSessions();
  const document = sessions?.document;
  if (!sessions || !document?.settings) return null;
  const context = sessions.running ? sessions.turn?.context ?? document.context : document.context;
  const compacting = sessions.running && sessions.turn?.phase === "compacting";
  const percentage = context && context.contextWindow > 0 ? Math.min(100, Math.round(context.estimatedTokens / context.contextWindow * 100)) : null;
  const detail = context
    ? `Estimated ${number.format(context.estimatedTokens)} of ${number.format(context.contextWindow)} tokens. Automatic compaction starts at ${number.format(context.thresholdTokens)} tokens (90%). Compacted ${context.compactionCount} ${context.compactionCount === 1 ? "time" : "times"}.`
    : "Context usage will be estimated when this conversation runs. Automatic compaction starts at 90% of the model context window.";
  return <span className="context-indicator" data-compacting={compacting || undefined}
    title={`${compacting ? "Compacting conversation. " : ""}${detail}\nType /compact to summarize older context. Full conversation history stays saved.`}>
    <svg className="context-indicator__meter" width="32" height="32" viewBox="0 0 32 32"
      role="meter" aria-label="Estimated context usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage ?? 0} aria-valuetext={detail}>
      <circle className="context-indicator__track" cx="16" cy="16" r="14" />
      <circle className="context-indicator__progress" cx="16" cy="16" r="14" pathLength="100"
        strokeDasharray={`${percentage ?? 0} 100`} transform="rotate(-90 16 16)" />
    </svg>
    <span className="context-indicator__label" aria-hidden="true">{compacting ? "…" : percentage === null ? "?" : `${percentage}%`}</span>
  </span>;
}
