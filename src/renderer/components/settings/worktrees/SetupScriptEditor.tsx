import { useEffect, useState } from "react";
import type { SetupScript } from "@contracts/worktrees";

/** A project's setup script: the command each new worktree runs, and whether the agent waits for it. */
export function SetupScriptEditor({ script, busy, onSave }: { script: SetupScript | null; busy: boolean; onSave(script: SetupScript | null): void }) {
  const [name, setName] = useState(script?.name ?? "Setup"), [command, setCommand] = useState(script?.command ?? ""), [wait, setWait] = useState(script?.wait ?? true);
  useEffect(() => { setName(script?.name ?? "Setup"); setCommand(script?.command ?? ""); setWait(script?.wait ?? true); }, [script]);
  const changed = !script ? !!command.trim() : name !== script.name || command !== script.command || wait !== script.wait;
  const valid = !!name.trim() && name.trim().length <= 120 && !!command.trim() && command.length <= 10_000;
  return <article className="git-settings__row worktree-settings__script" aria-labelledby="worktree-setup-script-title">
    <div className="git-settings__text">
      <h2 id="worktree-setup-script-title">Setup script</h2>
      <p>Runs automatically in each new worktree, such as installing dependencies. It gets FLAME_PROJECT_ROOT and FLAME_WORKTREE_PATH.</p>
    </div>
    <div className="worktree-settings__script-fields">
      <label><span>Name</span><input value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label><span>Command</span><textarea value={command} rows={3} spellCheck={false} placeholder="bun install" disabled={busy} onChange={event => setCommand(event.target.value)} /></label>
      <label className="worktree-settings__check"><input type="checkbox" checked={wait} disabled={busy} onChange={event => setWait(event.target.checked)} />Wait for it to finish before the agent starts</label>
      <div className="worktree-settings__script-actions">
        {script && <button type="button" className="git-settings__reset" disabled={busy} onClick={() => onSave(null)}>Remove</button>}
        <button type="button" className="git-button git-button--outline git-button--xs" disabled={busy || !changed || !valid} onClick={() => onSave({ name: name.trim(), command, wait })}>Save</button>
      </div>
    </div>
  </article>;
}
