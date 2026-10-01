import { useState } from "react";
import { clientSettings, useClientSettings, type ClientSettings, type NotificationMode } from "../../../lib/clientSettings";
import { includesNotifications, includesSound, NOTIFICATION_MODE_LABELS } from "../../notifications/notificationLogic";
import { unlockNotificationSounds } from "../../notifications/sounds";
import { Choice, SettingsRow, Toggle } from "../SettingsControls";

const modifier = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl";
const NOTIFICATIONS_DESCRIPTION = "System alerts when a thread finishes or fails. Applies to this device while Flame is open.";
/** Settings → General: how this device behaves, such as sending while the agent works and thread notifications. */
export function GeneralSettings() {
  const settings = useClientSettings();
  const [checking, setChecking] = useState(false), [problem, setProblem] = useState<string | null>(null);
  async function chooseNotifications(mode: NotificationMode) {
    setProblem(null);
    if (includesNotifications(mode)) {
      setChecking(true);
      // As in T3 Code, a mode the system cannot show is not saved, and sound alone stays available.
      const supported = await window.flame.notificationsSupported?.().catch(() => false) ?? false;
      setChecking(false);
      if (!supported) { setProblem("Notifications are unavailable on this system. Sound only is still available."); return; }
    }
    if (includesSound(mode)) unlockNotificationSounds();
    clientSettings.update({ notificationMode: mode });
  }
  return <section className="git-settings" aria-labelledby="general-settings-heading">
    <h1 id="general-settings-heading">General</h1>
    <div className="git-settings__list">
      <SettingsRow id="follow-up-behavior" title="Follow-up behavior"
        description={`Queue follow-ups while the agent runs or steer the current run. Press ${modifier} + Enter to do the opposite for one message.`}>
        <Choice<ClientSettings["followUpBehavior"]> label="Follow-up behavior" value={settings.followUpBehavior} options={[["queue", "Queue"], ["steer", "Steer"]]}
          onChange={followUpBehavior => clientSettings.update({ followUpBehavior })} />
      </SettingsRow>
      <SettingsRow id="composer-collapse" title="Collapse composer on scroll"
        description="Rest the composer of an existing thread into a single line when you scroll the conversation. Focus the composer or start typing to expand it again.">
        <Toggle label="Collapse composer on scroll" checked={settings.composerCollapseOnScroll} onChange={composerCollapseOnScroll => clientSettings.update({ composerCollapseOnScroll })} />
      </SettingsRow>
      <SettingsRow id="thread-notifications" title="Thread notifications" description={problem ?? NOTIFICATIONS_DESCRIPTION}>
        <Choice<NotificationMode> label="Thread notifications" value={settings.notificationMode} disabled={checking}
          options={Object.entries(NOTIFICATION_MODE_LABELS) as [NotificationMode, string][]} onChange={mode => { void chooseNotifications(mode); }} />
      </SettingsRow>
      <SettingsRow id="in-app-notifications" title="In-app notifications" description="Show a toast when another thread finishes or fails while Flame has focus.">
        <Toggle label="In-app notifications" checked={settings.inAppNotifications} onChange={inAppNotifications => clientSettings.update({ inAppNotifications })} />
      </SettingsRow>
    </div>
  </section>;
}
