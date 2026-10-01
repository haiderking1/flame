import { useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { ProjectWorktreeSettings, WorktreeDefaults } from "@contracts/worktrees";
import { saveProjectWorktreeSettings, saveWorktreeDefaults, worktreeErrorMessage } from "../../../backend/worktrees";

/** Saves worktree defaults and project overrides, one change at a time, keeping the last error to show. */
export function useWorktreeSettingsEditor() {
  const saveDefaults = useAtomSet(saveWorktreeDefaults, { mode: "promise" });
  const saveProject = useAtomSet(saveProjectWorktreeSettings, { mode: "promise" });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function run(work: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await work(); } catch (failure) { setError(worktreeErrorMessage(failure, "Worktree settings could not be saved. Try again.")); } finally { setBusy(false); }
  }
  return {
    busy, error,
    defaults: (defaults: WorktreeDefaults) => run(() => saveDefaults(defaults)),
    project: (project: ProjectWorktreeSettings) => run(() => saveProject(project)),
  };
}
