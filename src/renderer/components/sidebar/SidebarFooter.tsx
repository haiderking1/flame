import { lazy, Suspense } from "react";
import { SettingsIcon } from "../settings/SettingsIcon";
import { PickerIcon } from "../projects/PickerIcon";
import { showsUpdateButton } from "../updates/updateText";
import { useDesktopUpdate } from "../updates/useDesktopUpdate";
import "./sidebar-footer.css";

// Loaded only when there is an update to act on, so it stays out of the startup bundle.
const UpdateButton = lazy(() => import("../updates/UpdateButton").then(module => ({ default: module.UpdateButton })));

export function SidebarFooter({ settings, onClick }: { settings: boolean; onClick(): void }) {
  const updates = useDesktopUpdate();
  return <footer className="sidebar-footer">
    <button type="button" className="sidebar-footer__settings" aria-label={settings ? "Back to workspace" : "Settings"} onClick={onClick}>
      {settings ? <PickerIcon name="back" /> : <SettingsIcon />}{settings ? "Back" : "Settings"}
    </button>
    {showsUpdateButton(updates.state) && <Suspense fallback={null}><UpdateButton updates={updates} /></Suspense>}
  </footer>;
}
