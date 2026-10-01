import { useEffect, useState } from "react";
import type { WorktreeCleanupRules } from "@contracts/worktrees";
import { SettingsRow, Toggle } from "./SettingsControls";

const DEFAULT_DAYS = 30;
/** T3 Code's automatic worktree cleanup rules; worktrees with local changes are always kept. */
export function CleanupRules({ id, rules, busy, onChange }: { id: string; rules: WorktreeCleanupRules; busy: boolean; onChange(rules: WorktreeCleanupRules): void }) {
  const [days, setDays] = useState(String(rules.afterDays ?? DEFAULT_DAYS));
  useEffect(() => { setDays(String(rules.afterDays ?? DEFAULT_DAYS)); }, [rules.afterDays]);
  const commitDays = () => {
    const value = Number.parseInt(days, 10);
    if (Number.isInteger(value) && value >= 1 && value <= 3650) { if (value !== rules.afterDays) onChange({ ...rules, afterDays: value }); }
    else setDays(String(rules.afterDays ?? DEFAULT_DAYS));
  };
  return <>
    <SettingsRow id={`${id}-delete`} title="Delete worktrees with deleted threads" description="Remove unused worktrees when their threads are deleted. Worktrees with local changes are kept.">
      <Toggle label="Delete worktrees with deleted threads" checked={rules.onDelete} disabled={busy} onChange={onDelete => onChange({ ...rules, onDelete })} />
    </SettingsRow>
    <SettingsRow id={`${id}-inactive`} title="Delete inactive worktrees" description="Remove worktrees after their threads have been inactive for this many days. Branches and thread history are kept.">
      {rules.afterDays !== null && <label className="worktree-settings__days">
        <input type="number" min={1} max={3650} value={days} disabled={busy} aria-label="Days of inactivity" onChange={event => setDays(event.target.value)} onBlur={commitDays}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commitDays(); } }} /><span>days</span></label>}
      <Toggle label="Delete inactive worktrees" checked={rules.afterDays !== null} disabled={busy}
        onChange={on => onChange({ ...rules, afterDays: on ? Number.parseInt(days, 10) || DEFAULT_DAYS : null })} />
    </SettingsRow>
    <SettingsRow id={`${id}-merged`} title="Delete merged worktrees" description="Remove worktrees whose pull request is merged and whose commits are included in the default branch.">
      <Toggle label="Delete merged worktrees" checked={rules.onMerge} disabled={busy} onChange={onMerge => onChange({ ...rules, onMerge })} />
    </SettingsRow>
    <SettingsRow id={`${id}-unchanged`} title="Delete unchanged worktrees" description="Remove worktrees with no commits beyond the default branch.">
      <Toggle label="Delete unchanged worktrees" checked={rules.unchanged} disabled={busy} onChange={unchanged => onChange({ ...rules, unchanged })} />
    </SettingsRow>
  </>;
}
