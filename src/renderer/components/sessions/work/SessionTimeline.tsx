import { lazy, Suspense, useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { Option } from "effect";
import type { SessionEntry, SessionLocation } from "@contracts/sessions";
import type { TurnSnapshot } from "@contracts/turns";
import type { BashJob } from "@contracts/bash";
import type { WorkActivity } from "@contracts/work";
import type { CompactionInfo } from "@contracts/compaction";
import type { PendingImageMessage } from "../usePendingImageMessage";
import { CompactionMarker } from "./CompactionMarker";
import { ThinkingLabel } from "./ThinkingLabel";
import { bashJobsAtom } from "../../../backend/bash";
import { WorkGroup } from "./WorkGroup";
import { isRunning } from "./ToolRow";
import { UserMessage } from "./UserMessage";
import { TimelineRow } from "./TimelineRow";
import { shareJobs } from "./rowSharing";
import { ToolDisclosures } from "./ToolDisclosure";
import { MeasuredList } from "../../virtual/MeasuredList";
import { useWorktreeSetup } from "./useWorktreeSetup";
import { QueuedFollowUps } from "./QueuedFollowUps";
import { useSessions } from "../SessionContext";
import { useHistoryContainer } from "../../virtual/HistoryScrollContext";
const EMPTY_JOBS: readonly BashJob[] = [];
// Only shown while a worktree is set up, so it loads then rather than at startup.
const WorktreeSetupCard = lazy(() => import("./WorktreeSetupCard"));
type Item = { type: "row"; entry: SessionEntry; key: string } | { type: "marker"; compaction: CompactionInfo; key: string };
const itemKey = (item: Item) => item.key;
function jobActivity(turnId: string, jobs: readonly BashJob[], text = ""): WorkActivity {
  const own = jobs.filter(job => job.turnId === turnId);
  return { turnId, startedAt: Math.min(...own.map(job => job.createdAt)), finishedAt: null, answer: "", steps: [
    ...(text ? [{ kind: "message" as const, id: "commentary", text }] : []),
    ...own.map(job => ({ kind: "tool" as const, id: job.callId, callId: job.callId, name: "bash", command: job.command, jobId: job.id, error: null })),
  ] };
}
export function SessionTimeline({ location, entries, compactions = [], turn, revision, imagePreview }: {
  location: SessionLocation; entries: readonly SessionEntry[]; compactions?: readonly CompactionInfo[]; turn: TurnSnapshot | null; revision: number; imagePreview?: PendingImageMessage | null;
}) {
  const scroll = useHistoryContainer();
  const sessions = useSessions();
  const stableLocation = useMemo(() => ({ projectId: location.projectId, sessionId: location.sessionId }), [location.projectId, location.sessionId]);
  const setup = useWorktreeSetup(stableLocation);
  const result = useAtomValue(bashJobsAtom(`${location.projectId}:${location.sessionId}`));
  const previousJobs = useRef<readonly BashJob[]>(EMPTY_JOBS);
  const jobs = shareJobs(previousJobs.current, Option.getOrElse(AsyncResult.value(result), () => EMPTY_JOBS)); previousJobs.current = jobs;
  const oldGroups = useRef(new Map<string, readonly BashJob[]>());
  const groups = useMemo(() => {
    const grouped = new Map<string, BashJob[]>();
    for (const job of jobs) { const own = grouped.get(job.turnId) ?? []; own.push(job); grouped.set(job.turnId, own); }
    const shared = new Map<string, readonly BashJob[]>();
    for (const [id, own] of grouped) { const old = oldGroups.current.get(id); shared.set(id, old && old.length === own.length && own.every((job, index) => job === old[index]) ? old : own); }
    oldGroups.current = shared; return shared;
  }, [jobs]);
  // Persisted transcript entries are immutable. Keep their objects across page refreshes.
  const retained = useRef(new Map<string, SessionEntry>());
  const persisted = useMemo(() => {
    const rows = entries.filter(entry => entry.kind !== "settings").map(entry => retained.current.get(entry.id) ?? entry);
    retained.current = new Map(rows.map(entry => [entry.id, entry])); return rows;
  }, [entries]);
  const live = useMemo<SessionEntry | null>(() => {
    if (!turn || turn.operation === "compaction" || !(turn.status === "running" || turn.revision > revision || turn.revision < 0)) return null;
    return { id: turn.entryId ?? turn.id, turnId: turn.id, parentId: null, settings: null, createdAt: Number.MAX_SAFE_INTEGER, kind: "assistant", text: turn.text, activity: turn.activity ?? (jobs.some(job => job.turnId === turn.id) ? jobActivity(turn.id, jobs, turn.text) : undefined), turnStatus: turn.status };
  }, [turn, revision, jobs]);
  const rows = live && !persisted.some(entry => (entry.turnId ?? entry.activity?.turnId ?? entry.id) === turn?.id) ? [...persisted, live] : persisted;
  const represented = new Set(rows.map(row => row.activity?.turnId));
  const offscreen = [...new Set(jobs.filter(job => isRunning(job) && !represented.has(job.turnId)).map(job => job.turnId))];
  const markers = [...new Map(compactions.map(item => [item.id, item])).values()].sort((a, b) => a.createdAt - b.createdAt);
  const timeline: Item[] = [];
  for (const entry of rows) {
    while (markers.length && markers[0]!.createdAt < entry.createdAt && markers[0]!.leafId !== entry.id) { const compaction = markers.shift()!; timeline.push({ type: "marker", compaction, key: compaction.id }); }
    timeline.push({ type: "row", entry, key: entry.turnId ?? entry.activity?.turnId ?? entry.id });
    while (markers.length && markers[0]!.leafId === entry.id) { const compaction = markers.shift()!; timeline.push({ type: "marker", compaction, key: compaction.id }); }
  }
  timeline.push(...markers.map(compaction => ({ type: "marker" as const, compaction, key: compaction.id })));
  const compacting = turn?.status === "running" && turn.phase === "compacting";
  const pending = imagePreview?.sending && !rows.some(row => row.kind === "user" && imagePreview.images.every(image => row.images?.some(saved => saved.id === image.id))) ? imagePreview : null;
  // A worktree setup shows just before the response it prepared; one with no response in view (a pull request checkout) shows last.
  const setupCard = setup && <Suspense fallback={null}><WorktreeSetupCard location={stableLocation} snapshot={setup} onCancel={() => { void sessions?.stop(); }} /></Suspense>;
  const setupRow = setup && timeline.some(item => item.type === "row" && item.key === setup.turnId && item.entry.kind === "assistant") ? setup.turnId : null;
  function render(item: Item) {
    if (item.type === "row" && item.key === setupRow) return <>{setupCard}{row(item)}</>;
    return row(item);
  }
  function row(item: Item) {
    return item.type === "marker" ? <CompactionMarker compaction={item.compaction} /> : <TimelineRow entry={item.entry} jobs={groups.get(item.entry.activity?.turnId ?? "") ?? EMPTY_JOBS} location={stableLocation}
      compacting={!!compacting && item.key === turn?.id} imagePreview={item.entry.images?.some(image => imagePreview?.images.some(source => source.id === image.id)) ? imagePreview : undefined} />;
  }
  return <ToolDisclosures>
    {scroll ? <MeasuredList items={timeline} itemKey={itemKey} render={render} scroll={scroll} windowAnchor /> : timeline.map(item => <div key={item.key}>{render(item)}</div>)}
    {pending && <UserMessage text={pending.text} images={pending.images} pending />}
    {compacting && turn?.operation === "compaction" && <p className="turn-status" role="status"><ThinkingLabel>Compacting conversation</ThinkingLabel></p>}
    {offscreen.map(id => <WorkGroup key={id} activity={jobActivity(id, jobs)} running={false} jobs={groups.get(id) ?? EMPTY_JOBS} location={stableLocation} />)}
    {!setupRow && setupCard}
    <QueuedFollowUps scope={`${stableLocation.projectId}:${stableLocation.sessionId}`} />
    {turn?.message && <p className="turn-feedback" role="status">{turn.message}</p>}
  </ToolDisclosures>;
}
