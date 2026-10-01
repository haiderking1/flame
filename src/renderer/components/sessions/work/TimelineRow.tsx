import { memo, useMemo } from "react";
import type { SessionEntry, SessionLocation } from "@contracts/sessions";
import type { BashJob } from "@contracts/bash";
import type { PendingImageMessage } from "../usePendingImageMessage";
import { UserMessage } from "./UserMessage";
import { AssistantContent } from "./AssistantContent";
import { recordRowRender } from "../../../lib/performance";
export const TimelineRow = memo(function TimelineRow({ entry, jobs, location, compacting, imagePreview }: {
  entry: SessionEntry; jobs: readonly BashJob[]; location: SessionLocation; compacting: boolean; imagePreview?: PendingImageMessage | null;
}) {
  recordRowRender(entry.turnId ?? entry.activity?.turnId ?? entry.id);
  const images = useMemo(() => (entry.images ?? []).map(image => imagePreview?.images.find(source => source.id === image.id) ?? { id: image.id, name: image.name, image, location }), [entry.images, imagePreview, location]);
  return <div data-history-entry={entry.id}>{entry.kind === "user" ? <UserMessage text={entry.text ?? ""} images={images} entry={entry} /> : <AssistantContent text={entry.text ?? ""} activity={entry.activity} status={entry.turnStatus ?? "completed"} compacting={compacting} jobs={jobs} location={location} />}</div>;
});
