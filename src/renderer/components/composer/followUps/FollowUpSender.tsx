import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { modelsAtom } from "../../../backend/models";
import { readSession, sessionErrorMessage } from "../../../backend/sessions";
import { startTurn, turnAtom } from "../../../backend/turns";
import { useUploadImages } from "../../images/useUploadImages";
import { toastStore } from "../../toasts/toastStore";
import { nextDue, settled } from "./followUpLogic";
import { followUpStore } from "./followUpStore";

/**
 * Sends queued follow-ups for every session that has some, open or not (T3 Code's QueuedMessageSender): each goes when
 * due, one at a time, and stays shown until the backend delivers it as the next message or gives it back.
 */
export function FollowUpSender() {
  useSyncExternalStore(followUpStore.subscribe, followUpStore.version);
  return <>{followUpStore.scopes().map(scope => <SessionSender key={scope} scope={scope} />)}</>;
}
function SessionSender({ scope }: { scope: string }) {
  const location = useMemo(() => { const [projectId, sessionId] = scope.split(":") as [string, string]; return { projectId, sessionId }; }, [scope]);
  const list = useSyncExternalStore(followUpStore.subscribe, () => followUpStore.list(scope));
  const turn = Option.getOrElse(AsyncResult.value(useAtomValue(turnAtom(scope))), () => null);
  const accountKey = Option.getOrUndefined(AsyncResult.value(useAtomValue(modelsAtom)))?.accountKey ?? null;
  const upload = useUploadImages();
  const read = useAtomSet(readSession, { mode: "promise" }), start = useAtomSet(startTurn, { mode: "promise" });
  useEffect(() => {
    const { delivered, returned } = settled(list, turn);
    if (delivered.length) followUpStore.remove(scope, delivered.map(item => item.id));
    if (returned.length) followUpStore.giveBack(scope, returned.map(item => item.id));
    const next = nextDue(list, turn);
    if (!next || !accountKey) return;
    const signal = followUpStore.prepare(scope, next.id);
    void (async () => {
      let title = "";
      try {
        if (next.images.length) await upload(location, next.images, signal);
        signal.throwIfAborted();
        const saved = await read(location);
        title = saved.title;
        if (!followUpStore.dispatch(scope, next.id)) return;
        await start({ ...location, revision: saved.revision, requestId: next.requestId, text: next.text, accountKey, images: next.images.map(image => image.id) });
        followUpStore.update(scope, next.id, { state: "sent" });
      } catch (error) {
        if (signal.aborted) return;
        followUpStore.fail(scope, next.id);
        toastStore.show({ id: `follow-up:${next.id}`, scope: location.projectId, type: "error", title: title ? `Queued message not sent in "${title}"` : "Queued message not sent",
          description: error ? sessionErrorMessage(error) : "Use Send now to try again." });
      }
    })();
  }, [list, turn, accountKey]);
  return null;
}
