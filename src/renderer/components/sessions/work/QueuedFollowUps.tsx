import { useSyncExternalStore } from "react";
import { MentionText } from "../../composer/mentions/MentionText";
import { followUpStore } from "../../composer/followUps/followUpStore";
import { statusLabel } from "../../composer/followUps/followUpLogic";
import { WorkspaceIcon } from "../../workspace/WorkspaceIcon";
import "./queued-follow-ups.css";

/**
 * T3 Code's queued messages at the end of the timeline: dashed bubbles marked Queued or Sending, each with Send now and
 * Cancel (which returns it to the composer). The first one notes Ctrl+Shift+Enter.
 */
export function QueuedFollowUps({ scope }: { scope: string }) {
  const list = useSyncExternalStore(followUpStore.subscribe, () => followUpStore.list(scope));
  if (!list.length) return null;
  const head = list.find(item => item.state === "waiting");
  return <ol className="queued-follow-ups" aria-label="Queued messages">
    {list.map(item => {
      const sending = item.state !== "waiting", status = statusLabel(item, item === head);
      const attachments = item.images.length ? `${item.images.length} attachment${item.images.length === 1 ? "" : "s"}` : null;
      return <li key={item.id} className="queued-follow-up" data-state={item.state}>
        <div className="queued-follow-up__bubble">
          {item.text && <p><MentionText text={item.text} /></p>}
          {attachments && <p className="queued-follow-up__summary">{attachments}</p>}
        </div>
        <div className="queued-follow-up__meta">
          <span className="queued-follow-up__status" title={status} aria-label={status}><WorkspaceIcon name="history" />{sending ? "Sending" : "Queued"}</span>
          {!sending && <>
            <button type="button" aria-label="Send now" title={item === head ? "Send now (Ctrl+Shift+Enter)" : "Send now"}
              onClick={() => followUpStore.update(scope, item.id, { mode: "steer", hold: false })}><WorkspaceIcon name="arrow-up" /></button>
            <button type="button" aria-label="Cancel and return to the composer" title="Cancel and return to the composer"
              onClick={() => followUpStore.giveBack(scope, [item.id])}><WorkspaceIcon name="close" /></button>
          </>}
        </div>
      </li>;
    })}
  </ol>;
}
