import type { CompactionInfo } from "@contracts/compaction";
import { Markdown } from "../../markdown/Markdown";
import "./compaction-marker.css";

const number = new Intl.NumberFormat();
export function CompactionMarker({ compaction }: { compaction: CompactionInfo }) {
  return <details className="compaction-marker">
    <summary>Conversation compacted <span>~{number.format(compaction.tokensBefore)} → ~{number.format(compaction.tokensAfter)} tokens</span></summary>
    <div className="compaction-marker__detail">
      <p>Older context was replaced with this summary for the model. Summaries can omit details; your full conversation history remains saved.</p>
      <Markdown text={compaction.summary} />
    </div>
  </details>;
}
