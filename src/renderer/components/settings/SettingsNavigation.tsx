import { SettingsIcon } from "./SettingsIcon";
import "./settings-navigation.css";

export type SettingsSection = "providers" | "usage";
export function SettingsNavigation({ section, onSelect }: { section: SettingsSection; onSelect(section: SettingsSection): void }) {
  return <nav className="settings-navigation" aria-label="Settings sections">
    <button type="button" aria-current={section === "providers" ? "page" : undefined} onClick={() => onSelect("providers")}><SettingsIcon providers />Providers</button>
    <button type="button" aria-current={section === "usage" ? "page" : undefined} onClick={() => onSelect("usage")}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 20V10m8 10V4m8 16v-7" /></svg>Usage
    </button>
  </nav>;
}
