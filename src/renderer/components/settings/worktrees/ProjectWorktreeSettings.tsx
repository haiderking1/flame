import type { Project } from "@contracts/projects";
import { inheritedProjectSettings, type ProjectWorktreeSettings, type WorktreeSettings, type WorktreeSubmodules } from "@contracts/worktrees";
import type { WorkspaceMode } from "@contracts/session-workspace";
import { CleanupRules } from "./CleanupRules";
import { Choice, SettingsRow } from "../SettingsControls";
import { SUBMODULE_LABELS } from "./submoduleLabels";
import { SetupScriptEditor } from "./SetupScriptEditor";

type Inherit<T extends string> = T | "inherit";
/** Overrides for one project; anything left on "Inherit" follows the defaults above. */
export function ProjectWorktreeSettingsPanel({ project, settings, busy, onSave }: { project: Project; settings: WorktreeSettings; busy: boolean; onSave(next: ProjectWorktreeSettings): void }) {
  const current = settings.projects.find(item => item.projectId === project.id) ?? inheritedProjectSettings(project.id);
  const save = (patch: Partial<ProjectWorktreeSettings>) => onSave({ ...current, ...patch });
  const id = `worktree-project-${project.id}`;
  const cleanupMode = current.cleanup?.mode ?? "inherit";
  return <>
    <SettingsRow id={`${id}-mode`} title="Workspace" description="Where new threads in this project start.">
      <Choice<Inherit<WorkspaceMode>> label="Project default workspace" value={current.defaultMode ?? "inherit"} disabled={busy}
        options={[["inherit", "Inherit"], ["local", "Current checkout"], ["worktree", "New worktree"]]}
        onChange={value => save({ defaultMode: value === "inherit" ? null : value })} />
    </SettingsRow>
    <SettingsRow id={`${id}-origin`} title="Start from origin" description="Creates the worktree from the latest matching branch on origin instead of your local branch.">
      <Choice<"inherit" | "on" | "off"> label="Project start from origin" value={current.startFromOrigin === null ? "inherit" : current.startFromOrigin ? "on" : "off"} disabled={busy}
        options={[["inherit", "Inherit"], ["on", "On"], ["off", "Off"]]} onChange={value => save({ startFromOrigin: value === "inherit" ? null : value === "on" })} />
    </SettingsRow>
    <SettingsRow id={`${id}-submodules`} title="Submodules" description="How new worktrees in this project populate git submodules.">
      <Choice<Inherit<WorktreeSubmodules>> label="Project submodules" value={current.submodules ?? "inherit"} disabled={busy}
        options={[["inherit", "Inherit"], ...Object.entries(SUBMODULE_LABELS) as [WorktreeSubmodules, string][]]} onChange={value => save({ submodules: value === "inherit" ? null : value })} />
    </SettingsRow>
    <SettingsRow id={`${id}-cleanup`} title="Automatic worktree cleanup" description="Inherit the rules above, turn cleanup off for this project, or set its own rules.">
      <Choice<"inherit" | "off" | "custom"> label="Project worktree cleanup" value={cleanupMode} disabled={busy} options={[["inherit", "Inherit"], ["off", "Off"], ["custom", "Custom"]]}
        onChange={value => save({ cleanup: value === "inherit" ? null : value === "off" ? { mode: "off" } : { mode: "custom", rules: current.cleanup?.mode === "custom" ? current.cleanup.rules : settings.defaults.cleanup } })} />
    </SettingsRow>
    {current.cleanup?.mode === "custom" && <div className="worktree-settings__nested">
      <CleanupRules id={`${id}-rules`} rules={current.cleanup.rules} busy={busy} onChange={rules => save({ cleanup: { mode: "custom", rules } })} />
    </div>}
    <SetupScriptEditor script={current.setupScript} busy={busy} onSave={setupScript => save({ setupScript })} />
  </>;
}
