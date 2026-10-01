import type { Ref } from "react";
import { useActiveWorkspace } from "./useActiveWorkspace";
import { GitControl } from "./git/GitControl";
import { WorkspaceIcon } from "./WorkspaceIcon";
import "./workspace-actions.css";
type Props={diffOpen:boolean;onToggleDiff():void;diffButtonRef:Ref<HTMLButtonElement>};
export function WorkspaceActions({diffOpen,onToggleDiff,diffButtonRef}:Props) {
  const { key } = useActiveWorkspace();
  return <header className="workspace-actions"><nav aria-label="Workspace actions">
    {key ? <GitControl key={key} workspace={key} /> : <div className="git-control" role="group" aria-label="Git actions"><button type="button" className="git-control__button git-control__primary" aria-label="Commit" disabled title="Select a project to use Git"><WorkspaceIcon name="commit" /><span className="git-control__label">Commit</span></button><span className="git-control__separator" aria-hidden="true" /><button type="button" className="git-control__button git-control__options" aria-label="Git action options" disabled><WorkspaceIcon name="chevron" /></button></div>}
    <button className="workspace-diff-toggle" ref={diffButtonRef} type="button" aria-label="Toggle diff panel" title="Toggle diff panel" aria-expanded={diffOpen} aria-controls="workspace-diff" onClick={onToggleDiff}><WorkspaceIcon name="diff" /></button>
  </nav></header>;
}
