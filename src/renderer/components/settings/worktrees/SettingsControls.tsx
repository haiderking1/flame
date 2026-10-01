import type { ReactNode } from "react";
import type { WorktreeSubmodules } from "@contracts/worktrees";

export const SUBMODULE_LABELS: Record<WorktreeSubmodules, string> = { recursive: "Recursive", "top-level": "Top level only", none: "Skip" };

/** One settings row: a title and description beside its controls, laid out like the Git settings page. */
export function SettingsRow({ id, title, description, children }: { id: string; title: string; description: ReactNode; children: ReactNode }) {
  return <article className="git-settings__row" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <div className="git-settings__text"><h2 id={`${id}-title`}>{title}</h2><p id={`${id}-description`}>{description}</p></div>
    <div className="worktree-settings__controls">{children}</div>
  </article>;
}
export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange(checked: boolean): void }) {
  return <input type="checkbox" role="switch" className="worktree-settings__switch" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />;
}
export function Choice<T extends string>({ label, value, options, disabled, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; disabled?: boolean; onChange(value: T): void }) {
  return <select className="worktree-settings__select" aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value as T)}>
    {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
  </select>;
}
