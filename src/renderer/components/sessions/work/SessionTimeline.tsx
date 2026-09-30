import { UserMessage } from "./UserMessage";
import type { PendingImageMessage } from "../usePendingImageMessage";
import type { ImageInfo } from "@contracts/image-types";
import { Fragment } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import type { SessionEntry, SessionLocation } from "@contracts/sessions";
import type { TurnSnapshot } from "@contracts/turns";
import type { BashJob } from "@contracts/bash";
import type { WorkActivity } from "@contracts/work";
import type { CompactionInfo } from "@contracts/compaction";
import { CompactionMarker } from "./CompactionMarker";
import { ThinkingLabel } from "./ThinkingLabel";
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
export function SessionTimeline({ location, entries, compactions = [], turn, revision, imagePreview }: {
  location: SessionLocation; entries: readonly SessionEntry[]; compactions?: readonly CompactionInfo[]; turn: TurnSnapshot | null; revision: number;
  imagePreview?: PendingImageMessage | null;
}) {
  const result = useAtomValue(bashJobsAtom(`${location.projectId}:${location.sessionId}`));
  const jobs = Option.getOrElse(AsyncResult.value(result), () => []);
  const rows = entries.filter(entry => entry.kind !== "settings").map(entry => ({
    key: entry.activity?.turnId ?? entry.id, entryId: entry.id, createdAt: entry.createdAt, kind: entry.kind, text: entry.text ?? "", images: entry.images ?? [], activity: entry.activity, status: entry.turnStatus ?? "completed",
  }));
  if (turn && turn.operation !== "compaction" && (turn.status === "running" || turn.revision > revision || turn.revision < 0)) {
    const activity = turn.activity ?? (jobs.some(job => job.turnId === turn.id) ? jobActivity(turn.id, jobs, turn.text) : undefined);
    if (!rows.some(row => row.key === turn.id)) rows.push({ key: turn.id, entryId: turn.entryId ?? turn.id, createdAt: Number.MAX_SAFE_INTEGER, kind: "assistant", text: turn.text, images: [] as readonly ImageInfo[], activity, status: turn.status });
  }
  const represented = new Set(rows.map(row => row.activity?.turnId));
  const offscreen = [...new Set(jobs.filter(job => isRunning(job) && !represented.has(job.turnId)).map(job => job.turnId))];
  const markers = [...new Map(compactions.map(item => [item.id, item])).values()].sort((a, b) => a.createdAt - b.createdAt);
  const timeline: Array<{ type: "row"; row: typeof rows[number] } | { type: "marker"; compaction: CompactionInfo }> = [];
  for (const row of rows) {
    while (markers.length && markers[0]!.createdAt < row.createdAt && markers[0]!.leafId !== row.entryId) timeline.push({ type: "marker", compaction: markers.shift()! });
    timeline.push({ type: "row", row });
    while (markers.length && markers[0]!.leafId === row.entryId) timeline.push({ type: "marker", compaction: markers.shift()! });
  }
  timeline.push(...markers.map(compaction => ({ type: "marker" as const, compaction })));
  const compacting = turn?.status === "running" && turn.phase === "compacting";
  const pending = imagePreview?.sending && !rows.some(row => row.kind === "user" && imagePreview.images.every(image => row.images.some(saved => saved.id === image.id))) ? imagePreview : null;
  return <>
    {timeline.map(item => item.type === "marker" ? <CompactionMarker key={item.compaction.id} compaction={item.compaction} /> : <Fragment key={item.row.key}>{item.row.kind === "user"
      ? <UserMessage text={item.row.text} images={item.row.images.map(image => imagePreview?.images.find(source => source.id === image.id) ?? { id: image.id, name: image.name, image, location })} />
      : <AssistantContent text={item.row.text} activity={item.row.activity} status={item.row.status} compacting={compacting && item.row.key === turn.id} jobs={jobs} location={location} />}</Fragment>)}
    {pending && <UserMessage text={pending.text} images={pending.images} pending />}
    {compacting && turn.operation === "compaction" && <p className="turn-status" role="status"><ThinkingLabel>Compacting conversation</ThinkingLabel></p>}
    {offscreen.map(id => <WorkGroup key={id} activity={jobActivity(id, jobs)} running={false} jobs={jobs} location={location} />)}
    {turn?.message && <p className="turn-feedback" role="status">{turn.message}</p>}
  </>;
}
