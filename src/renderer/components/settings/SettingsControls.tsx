import type { ReactNode } from "react";
import "./git/git-settings.css";
import "./settings-controls.css";
import { SelectMenu } from "../workspace/SelectMenu";

/** One settings row: a title and description beside its controls, laid out like the Git settings page. */
export function SettingsRow({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return <article className="git-settings__row" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <div className="git-settings__text"><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p></div>
    <div className="settings-row__controls">{children}</div>
  </article>;
}
export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }) {
  return <input type="checkbox" role="switch" className="settings-switch" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}
export function Choice<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; disabled?: boolean; onChange(value: T): void }) {
  return <SelectMenu value={value} options={options.map(([option, text]) => ({ value: option, label: text }))} onChange={onChange} label={label} disabled={disabled} triggerClassName="settings-select" menuClassName="settings-select-menu" />;
}
