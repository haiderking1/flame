import type { BashJob } from "@contracts/bash";
import type { SessionLocation } from "@contracts/sessions";
import type { WorkActivity } from "@contracts/work";
import { Markdown } from "../../markdown/Markdown";
import { WorkGroup } from "./WorkGroup";
import { ThinkingLabel } from "./ThinkingLabel";
import "../turn-response.css";

export function AssistantContent({ text, activity, status, compacting = false, jobs, location }: {
  text: string; activity?: WorkActivity; status: string; compacting?: boolean; jobs: readonly BashJob[]; location: SessionLocation;
}) {
  const running = status === "running";
  const answer = activity ? activity.answer : text;
  return <>
    {activity && <WorkGroup activity={activity} running={running} compacting={compacting} jobs={jobs} location={location} status={status} />}
    {answer && <article className="session-message session-message--assistant" aria-label="Flame"><Markdown text={answer} streaming={running} />{!running && status !== "completed" && <p className="turn-status">{status === "cancelled" ? "Response stopped" : status === "interrupted" ? "Response interrupted" : "Response failed"}</p>}</article>}
    {running && !activity && <p className="turn-status" role="status"><ThinkingLabel>{compacting ? "Compacting conversation" : text ? "Working" : "Thinking"}</ThinkingLabel></p>}
  </>;
}
