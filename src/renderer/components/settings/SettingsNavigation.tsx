import { SettingsIcon } from "./SettingsIcon";
import { WorkspaceIcon } from "../workspace/WorkspaceIcon";
import "./settings-navigation.css";

export type SettingsSection = "providers" | "usage" | "git" | "worktrees";
export const settingsSectionNames: Record<SettingsSection, string> = { providers: "Providers", usage: "Usage", git: "Git", worktrees: "Worktrees" };
export function SettingsNavigation({ section, onSelect }: { section: SettingsSection; onSelect(section: SettingsSection): void }) {
  return <nav className="settings-navigation" aria-label="Settings sections">
    <button type="button" aria-current={section === "providers" ? "page" : undefined} onClick={() => onSelect("providers")}><SettingsIcon providers />Providers</button>
    <button type="button" aria-current={section === "usage" ? "page" : undefined} onClick={() => onSelect("usage")}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 20V10m8 10V4m8 16v-7" /></svg>Usage
    </button>
    <button type="button" aria-current={section === "git" ? "page" : undefined} onClick={() => onSelect("git")}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="7" r="2" /><path d="M6 7v10M18 9c0 5-6 4-11.5 8.5" /></svg>Git
    </button>
    <button type="button" aria-current={section === "worktrees" ? "page" : undefined} onClick={() => onSelect("worktrees")}>
      <WorkspaceIcon name="folder-git-2" />Worktrees
    </button>
  </nav>;
}
