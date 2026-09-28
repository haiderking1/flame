import { useAtomSet } from "@effect/atom-react";
import type { ModelSelection } from "@contracts/models";
import { SessionError } from "@contracts/sessions";
import { changeSession, createSession, sessionHistory } from "../../backend/sessions";
import { startTurn } from "../../backend/turns";
import type { ProjectDraft } from "./projectDrafts";

export function useStartProjectSession() {
  const create = useAtomSet(createSession, { mode: "promise" });
  const change = useAtomSet(changeSession, { mode: "promise" });
  const history = useAtomSet(sessionHistory, { mode: "promise" });
  const run = useAtomSet(startTurn, { mode: "promise" });
  return async (projectId: string, draft: ProjectDraft, accountKey: string | null, settings: ModelSelection | null,
    persist: (value: ProjectDraft) => void) => {
    if (!draft.submittedText && (!accountKey || !settings)) throw new SessionError({ code: "INVALID", message: "Choose a connected model before sending." });
    const location = { projectId, sessionId: draft.sessionId };
    let saved = await create(location);
    let before: string | null = null;
    do {
      const page = await history({ ...location, before });
      const prior = page.entries.find(entry => entry.id === draft.requestId && entry.kind === "user");
      if (prior) {
        const edited = draft.text !== prior.text;
        if (edited && saved.draft !== draft.text) await change({ ...location, revision: saved.revision, type: "draft", draft: draft.text });
        return { location, edited };
      }
      before = page.nextBefore;
    } while (before);
    if (!accountKey || !settings) throw new SessionError({ code: "INVALID", message: "Choose a connected model before sending." });
    // Keep the draft recoverable even if configuration or the turn claim fails.
    if (saved.draft !== draft.text) saved = await change({ ...location, revision: saved.revision, type: "draft", draft: draft.text });
    if (JSON.stringify(saved.settings) !== JSON.stringify(settings)) {
      saved = await change({ ...location, revision: saved.revision, type: "configure", accountKey, settings });
    }
    persist({ ...draft, submittedText: draft.text });
    await run({ ...location, revision: saved.revision, requestId: draft.requestId, text: draft.text, accountKey });
    return { location, edited: false };
  };
}
