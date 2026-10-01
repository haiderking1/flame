import { useAtomSet } from "@effect/atom-react";
import type { ModelSelection } from "@contracts/models";
import { SessionError } from "@contracts/sessions";
import { changeSession, createSession, sessionHistory } from "../../backend/sessions";
import { configureWorkspace } from "../../backend/worktrees";
import { startTurn, stopTurn } from "../../backend/turns";
import { useUploadImages } from "../images/useUploadImages";
import { saveImageDraft, type DraftImage } from "../images/draft-storage";
import type { ProjectDraft } from "./projectDrafts";

export function useStartProjectSession() {
  const upload = useUploadImages();
  const stop = useAtomSet(stopTurn, { mode: "promise" });
  const create = useAtomSet(createSession, { mode: "promise" });
  const change = useAtomSet(changeSession, { mode: "promise" });
  const history = useAtomSet(sessionHistory, { mode: "promise" });
  const run = useAtomSet(startTurn, { mode: "promise" });
  const placeWorkspace = useAtomSet(configureWorkspace, { mode: "promise" });
  return async (projectId: string, draft: ProjectDraft, accountKey: string | null, settings: ModelSelection | null,
    persist: (value: ProjectDraft) => void, images: readonly DraftImage[] = [], signal?: AbortSignal) => {
    if (draft.submittedText === null && (!accountKey || !settings)) throw new SessionError({ code: "INVALID", message: "Choose a connected model before sending." });
    const location = { projectId, sessionId: draft.sessionId };
    let stopWarning = false;
    const stopIfCancelled = async () => { if (signal?.aborted) { try { await stop({ ...location, turnId: draft.requestId }); } catch { stopWarning = true; } } };
    let saved = await create(location);
    let before: string | null = null;
    do {
      const page = await history({ ...location, before });
      const prior = page.entries.find(entry => entry.requestId === draft.requestId && entry.kind === "user");
      if (prior) {
        const sentImages = prior.images?.map(image => image.id) ?? [];
        const edited = draft.text !== prior.text || images.some(image => !sentImages.includes(image.id));
        await saveImageDraft(`${location.projectId}:${location.sessionId}`, images.filter(image => !sentImages.includes(image.id)));
        await stopIfCancelled();
        if (edited && saved.draft !== draft.text) await change({ ...location, revision: saved.revision, type: "draft", draft: draft.text });
        return { location, edited, sentImages, stopWarning };
      }
      before = page.nextBefore;
    } while (before);
    if (!accountKey || !settings) throw new SessionError({ code: "INVALID", message: "Choose a connected model before sending." });
    // Keep the draft recoverable even if configuration or the turn claim fails.
    if (saved.draft !== draft.text) saved = await change({ ...location, revision: saved.revision, type: "draft", draft: draft.text });
    if (JSON.stringify(saved.settings) !== JSON.stringify(settings)) {
      saved = await change({ ...location, revision: saved.revision, type: "configure", accountKey, settings });
    }
    // Where the session works is settled before its first message, which creates a chosen new worktree.
    if (draft.workspace && JSON.stringify(saved.workspace) !== JSON.stringify(draft.workspace)) {
      saved = await placeWorkspace({ ...location, revision: saved.revision, workspace: draft.workspace });
    }
    await upload(location, images, signal);
    persist({ ...draft, submittedText: draft.text });
    await run({ ...location, revision: saved.revision, requestId: draft.requestId, text: draft.text, accountKey, images: images.map(image => image.id) });
    await stopIfCancelled();
    await saveImageDraft(`${location.projectId}:${location.sessionId}`, []).catch(() => {});
    return { location, edited: false, sentImages: images.map(image => image.id), stopWarning };
  };
}
