import { ImageGallery } from "../../images/ImageGallery";
import type { ImageInfo } from "@contracts/image-types";
import { Fragment } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import type { SessionEntry, SessionLocation } from "@contracts/sessions";
import type { TurnSnapshot } from "@contracts/turns";
import type { BashJob } from "@contracts/bash";
import type { WorkActivity } from "@contracts/work";
import { bashJobsAtom } from "../../../backend/bash";
import { AssistantContent } from "./AssistantContent";
import { WorkGroup } from "./WorkGroup";
import { isRunning } from "./ToolRow";

function jobActivity(turnId: string, jobs: readonly BashJob[], text = ""): WorkActivity {
  const own = jobs.filter(job => job.turnId === turnId);
  return { turnId, startedAt: Math.min(...own.map(job => job.createdAt)), finishedAt: null, answer: "", steps: [
    ...(text ? [{ kind: "message" as const, id: "commentary", text }] : []),
    ...own.map(job => ({ kind: "tool" as const, id: job.callId, callId: job.callId, name: "bash", command: job.command, jobId: job.id, error: null })),
  ] };
}
export function SessionTimeline({ location, entries, turn, revision }: {
  location: SessionLocation; entries: readonly SessionEntry[]; turn: TurnSnapshot | null; revision: number;
}) {
  const result = useAtomValue(bashJobsAtom(`${location.projectId}:${location.sessionId}`));
  const jobs = Option.getOrElse(AsyncResult.value(result), () => []);
  const rows = entries.filter(entry => entry.kind !== "settings").map(entry => ({
    key: entry.activity?.turnId ?? entry.id, kind: entry.kind, text: entry.text ?? "", images: entry.images ?? [], activity: entry.activity, status: entry.turnStatus ?? "completed",
  }));
  if (turn && (turn.status === "running" || turn.revision > revision || turn.revision < 0)) {
    const activity = turn.activity ?? (jobs.some(job => job.turnId === turn.id) ? jobActivity(turn.id, jobs, turn.text) : undefined);
    if (!rows.some(row => row.key === turn.id)) rows.push({ key: turn.id, kind: "assistant", text: turn.text, images: [] as readonly ImageInfo[], activity, status: turn.status });
  }
  const represented = new Set(rows.map(row => row.activity?.turnId));
  const offscreen = [...new Set(jobs.filter(job => isRunning(job) && !represented.has(job.turnId)).map(job => job.turnId))];
  return <>
    {rows.map(row => <Fragment key={row.key}>{row.kind === "user"
      ? <article className="session-message session-message--user" aria-label="You"><ImageGallery images={row.images.map(image => ({ id: image.id, name: image.name, image, location }))} />{row.text && <p>{row.text}</p>}</article>
      : <AssistantContent text={row.text} activity={row.activity} status={row.status} jobs={jobs} location={location} />}</Fragment>)}
    {offscreen.map(id => <WorkGroup key={id} activity={jobActivity(id, jobs)} running={false} jobs={jobs} location={location} />)}
    {turn?.message && <p className="turn-feedback" role="status">{turn.message}</p>}
  </>;
}
