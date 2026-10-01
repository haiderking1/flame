import { useEffect, useRef } from "react";
import { PickerIcon } from "../projects/PickerIcon";
import { ProvidersSettings } from "./ProvidersSettings";
import { UsageSettings } from "./usage/UsageSettings";
import { GitSettings } from "./git/GitSettings";
import { WorktreeSettings } from "./worktrees/WorktreeSettings";
import { settingsSectionNames, type SettingsSection } from "./SettingsNavigation";
import "./settings-page.css";

export function SettingsPage({ sidebarVisible, onClose, section }: { sidebarVisible: boolean; onClose(): void; section: SettingsSection }) {
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, [section]);
  return <main className="settings-page" aria-label="Settings" data-sidebar-visible={sidebarVisible} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); }
  }}>
    <header className="settings-page__header">
      <div ref={heading} tabIndex={-1} className="settings-page__breadcrumb"><span>Settings</span><span aria-hidden="true">/</span><span>{settingsSectionNames[section]}</span></div>
      <button type="button" aria-label="Close settings" title="Close settings" onClick={onClose}><PickerIcon name="close" /></button>
    </header>
    <div className="settings-page__content">{section === "providers" ? <ProvidersSettings /> : section === "usage" ? <UsageSettings /> : section === "worktrees" ? <WorktreeSettings /> : <GitSettings />}</div>
  </main>;
}
