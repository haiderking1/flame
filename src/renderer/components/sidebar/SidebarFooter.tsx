import { SettingsIcon } from "../settings/SettingsIcon";
import { PickerIcon } from "../projects/PickerIcon";
import "./sidebar-footer.css";

export function SidebarFooter({ settings, onClick }: { settings: boolean; onClick(): void }) {
  return <footer className="sidebar-footer">
    <button type="button" aria-label={settings ? "Back to workspace" : "Settings"} onClick={onClick}>
      {settings ? <PickerIcon name="back" /> : <SettingsIcon />}{settings ? "Back" : "Settings"}
    </button>
  </footer>;
}
