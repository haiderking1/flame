import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import type { WorktreeSubmodules } from "@contracts/worktrees";
import type { WorkspaceMode } from "@contracts/session-workspace";
import { projectsAtom } from "../../../backend/projects";
import { useWorktreeSettings } from "../../composer/workspace/worktreeDefaults";
import { CleanupRules } from "./CleanupRules";
import { ProjectWorktreeSettingsPanel } from "./ProjectWorktreeSettings";
import { Choice, SettingsRow, SUBMODULE_LABELS, Toggle } from "./SettingsControls";
import { useWorktreeSettingsEditor } from "./useWorktreeSettingsEditor";
import "../git/git-settings.css";
import "../../workspace/git/git-dialogs.css";
import "./worktree-settings.css";

/** Settings → Worktrees: where new threads start, how worktrees are made and cleaned up, and per-project overrides. */
export function WorktreeSettings() {
  const settings = useWorktreeSettings();
  const projects = useAtomValue(projectsAtom);
  const editor = useWorktreeSettingsEditor();
  const list = AsyncResult.isSuccess(projects) ? projects.value : [];
  const [chosen, setChosen] = useState<string | null>(null);
  const project = list.find(item => item.id === chosen) ?? list[0] ?? null;
  if (!settings) return <section className="git-settings"><h1>Worktrees</h1><p className="worktree-settings__loading" role="status">Loading worktree settings…</p></section>;
  const defaults = settings.defaults;
  return <section className="git-settings worktree-settings" aria-labelledby="worktree-settings-heading">
    <h1 id="worktree-settings-heading">Worktrees</h1>
    <div className="git-settings__list">
      <SettingsRow id="worktree-default-mode" title="Workspace" description="Where new threads start. Projects can override it.">
        <Choice<WorkspaceMode> label="Default workspace" value={defaults.defaultMode} disabled={editor.busy} options={[["local", "Current checkout"], ["worktree", "New worktree"]]}
          onChange={defaultMode => { void editor.defaults({ ...defaults, defaultMode }); }} />
      </SettingsRow>
      <SettingsRow id="worktree-origin" title="Start from origin" description="Creates the worktree from the latest matching branch on origin instead of your local branch.">
        <Toggle label="Start new worktrees from origin by default" checked={defaults.startFromOrigin} disabled={editor.busy} onChange={startFromOrigin => { void editor.defaults({ ...defaults, startFromOrigin }); }} />
      </SettingsRow>
      <SettingsRow id="worktree-submodules" title="Submodules" description="How new worktrees populate git submodules. Projects can override it.">
        <Choice<WorktreeSubmodules> label="Submodules" value={defaults.submodules} disabled={editor.busy} options={Object.entries(SUBMODULE_LABELS) as [WorktreeSubmodules, string][]}
          onChange={submodules => { void editor.defaults({ ...defaults, submodules }); }} />
      </SettingsRow>
    </div>
    <h1 className="worktree-settings__heading">Automatic worktree cleanup</h1>
    <div className="git-settings__list">
      <CleanupRules id="worktree-cleanup" rules={defaults.cleanup} busy={editor.busy} onChange={cleanup => { void editor.defaults({ ...defaults, cleanup }); }} />
    </div>
    <div className="worktree-settings__project-heading">
      <h1>Project</h1>
      {list.length > 1 && <select className="worktree-settings__select" aria-label="Project" value={project?.id ?? ""} onChange={event => setChosen(event.target.value)}>
        {list.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
    </div>
    <div className="git-settings__list">
      {project ? <ProjectWorktreeSettingsPanel key={project.id} project={project} settings={settings} busy={editor.busy} onSave={next => { void editor.project(next); }} />
        : <p className="worktree-settings__loading">Add a project to set its worktree options.</p>}
    </div>
    {editor.error && <p className="git-settings__error" role="alert">{editor.error}</p>}
  </section>;
}
