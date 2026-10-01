import { useEffect, useRef, useSyncExternalStore } from "react";
import { useClientSettings } from "../../../lib/clientSettings";
import type { DraftImage } from "../../images/draft-storage";
import { intentFor, type FollowUpMode } from "./followUpLogic";
import { followUpStore } from "./followUpStore";

type Attachments = { images: DraftImage[]; ready: boolean; saving: boolean; flush(): Promise<void>; sent(ids: readonly string[]): Promise<void>; add(files: readonly File[]): Promise<void> };
/**
 * The composer's follow-ups while the agent works, as in T3 Code: Enter queues or steers by the setting, Ctrl/Cmd+Enter
 * does the opposite for one message, Ctrl/Cmd+Shift+Enter sends the next queued message now, and messages taken back
 * (Cancel, Stop, or given back by the backend) return to the draft with their images.
 */
export function useComposerFollowUps({ scope, running, enqueue, draft, setDraft, attachments, blocked }: {
  scope: string | null; running: boolean; enqueue?: (text: string, images: readonly DraftImage[], mode: FollowUpMode) => void;
  draft: string; setDraft(value: string): void; attachments: Attachments; blocked: boolean;
}) {
  const settings = useClientSettings();
  const intent = useRef<FollowUpMode>(settings.followUpBehavior);
  useSyncExternalStore(followUpStore.subscribe, followUpStore.version);
  const queued = scope ? followUpStore.list(scope) : [];
  const canFollowUp = Boolean(running && enqueue && (draft.trim() || attachments.images.length) && attachments.ready && !attachments.saving && !blocked);
  const latestDraft = useRef(draft); latestDraft.current = draft;
  useEffect(() => {
    if (!scope || !attachments.ready || !followUpStore.hasReturned(scope)) return;
    const returned = followUpStore.takeReturned(scope);
    const text = [latestDraft.current.trim(), ...returned.map(item => item.text.trim())].filter(Boolean).join("\n\n");
    setDraft(text);
    const files = returned.flatMap(item => item.images).map(image => new File([image.file], image.name, { type: image.file.type }));
    if (files.length) void attachments.add(files);
  });
  return {
    canFollowUp,
    /** Prepares Enter: queue or steer, flipped by Ctrl/Cmd. */
    choose(alternate: boolean) { intent.current = intentFor(settings.followUpBehavior, alternate); },
    async submit() {
      if (!canFollowUp || !enqueue) return false;
      const images = [...attachments.images];
      await attachments.flush();
      enqueue(draft, images, intent.current);
      intent.current = settings.followUpBehavior;
      if (images.length) await attachments.sent(images.map(image => image.id));
      setDraft("");
      return true;
    },
    /** Ctrl/Cmd+Shift+Enter: the next queued message goes now. */
    sendNext() {
      const head = queued.find(item => item.state === "waiting");
      if (!scope || !head) return false;
      followUpStore.update(scope, head.id, { mode: "steer", hold: false });
      return true;
    },
    label: settings.followUpBehavior === "steer" ? "Steer" : "Queue",
  };
}
