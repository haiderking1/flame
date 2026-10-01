import { useEffect, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { GitFileView, GitStatus } from "@contracts/git";
import { gitFile, gitErrorMessage } from "../../../backend/git";
import type { WorkspaceKey } from "../../../backend/workspaceKey";
type State = { key: string | null; view: GitFileView | null; loading: boolean; failure: string | null };
const IDLE: State = { key: null, view: null, loading: false, failure: null };
function fingerprint(file: GitStatus["files"][number] | undefined) {
  return file ? JSON.stringify([file.index, file.worktree, file.originalPath, file.version ?? null, file.stagedStats ?? null, file.workingStats ?? null]) : "";
}
// Re-reads the selected file only when its own status entry (including its content version) changes or `reload` bumps; an unchanged result keeps the shown view.
export function useGitFileView(workspace: WorkspaceKey, path: string | null, scope: GitFileView["mode"], file: GitStatus["files"][number] | undefined, reload: number) {
  const read = useAtomSet(gitFile, { mode: "promise" });
  const [state, setState] = useState<State>(IDLE);
  const revision = fingerprint(file);
  useEffect(() => {
    if (!path) { setState(IDLE); return; }
    const key = `${workspace}\0${scope}\0${path}`;
    let alive = true;
    setState(old => old.key === key ? { ...old, loading: !old.view, failure: null } : { key, view: null, loading: true, failure: null });
    read({ workspace, path, mode: scope }).then(
      view => { if (alive) setState(old => ({ key, view: old.key === key && old.view?.version === view.version ? old.view : view, loading: false, failure: null })); },
      error => { if (alive) setState({ key, view: null, loading: false, failure: gitErrorMessage(error) }); },
    );
    return () => { alive = false; };
  }, [workspace, path, scope, revision, reload, read]);
  return state.key === `${workspace}\0${scope}\0${path}` ? state : { ...IDLE, loading: !!path };
}
