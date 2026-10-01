import { useMemo, useRef, useState } from "react";
import { useAtomSet } from "@effect/atom-react";
import type { GitStatus } from "@contracts/git";
import { workspaceProject, type WorkspaceKey } from "../../../backend/workspaceKey";
import { gitOpen, gitErrorMessage } from "../../../backend/git";
import { toastStore } from "../../toasts/toastStore";
import { GitDialogFrame } from "./GitDialogFrame";
import { StartTruncatedPath } from "./StartTruncatedPath";
import { FileIcon } from "../../files/FileIcon";

type File = GitStatus["files"][number];
const lines = (file: File) => {
  const staged = file.stagedStats, working = file.workingStats;
  return { additions: (staged?.additions ?? 0) + (working?.additions ?? 0), deletions: (staged?.deletions ?? 0) + (working?.deletions ?? 0) };
};
function Checkbox({ checked, indeterminate, label, onChange }: { checked: boolean; indeterminate?: boolean; label: string; onChange(): void }) {
  const ref = useRef<HTMLInputElement>(null);
  return <input ref={element => { ref.current = element; if (element) element.indeterminate = !!indeterminate; }} type="checkbox" className="git-checkbox" aria-label={label} checked={checked} onChange={onChange} />;
}
/** t3code's commit dialog: branch, the files to commit (Edit to exclude some), and an optional message the model fills in when empty. */
export default function CommitDialog({ workspace, status, onClose, onCommit }: { workspace: WorkspaceKey; status: GitStatus; onClose(): void;
  onCommit(input: { message: string; filePaths: readonly string[] | null; featureBranch: boolean }): void }) {
  const open = useAtomSet(gitOpen, { mode: "promise" });
  const [message, setMessage] = useState(""), [editing, setEditing] = useState(false), [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const files = status.files, selected = useMemo(() => files.filter(file => !excluded.has(file.path)), [files, excluded]);
  const allSelected = excluded.size === 0, noneSelected = selected.length === 0;
  const totals = selected.reduce((sum, file) => { const counts = lines(file); return { additions: sum.additions + counts.additions, deletions: sum.deletions + counts.deletions }; }, { additions: 0, deletions: 0 });
  const toggle = (path: string) => setExcluded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const submit = (featureBranch: boolean) => onCommit({ message, filePaths: allSelected ? null : selected.map(file => file.path), featureBranch });
  const openFile = (path: string) => { void open({ workspace, path }).catch(error => { const text = gitErrorMessage(error); toastStore.show({ id: `git-open:${path}`, scope: workspaceProject(workspace), type: "error", title: "Unable to open file", description: text, copy: text }); }); };
  return <GitDialogFrame title="Commit changes" description="Review and confirm your commit. Leave the message blank to auto-generate one." onClose={onClose} footer={<>
    <button type="button" className="git-button git-button--outline" onClick={onClose}>Cancel</button>
    <button type="button" className="git-button git-button--outline" disabled={noneSelected} onClick={() => submit(true)}>Commit on new branch</button>
    <button type="button" className="git-button git-button--primary" disabled={noneSelected} onClick={() => submit(false)}>Commit</button>
  </>}>
    <div className="git-commit__summary">
      <div className="git-commit__branch"><span className="git-muted">Branch</span><span className="git-commit__branch-value"><strong>{status.branch ?? "(detached HEAD)"}</strong>{status.isDefaultBranch && <span className="git-warning">Default branch</span>}</span></div>
      <div className="git-commit__files">
        <div className="git-commit__files-header">
          <div className="git-commit__files-label">
            {editing && files.length > 0 && <Checkbox label="Select all files" checked={allSelected} indeterminate={!allSelected && !noneSelected} onChange={() => setExcluded(allSelected ? new Set(files.map(file => file.path)) : new Set())} />}
            <span className="git-muted">Files</span>
            {!allSelected && !editing && <span className="git-muted">({selected.length} of {files.length})</span>}
          </div>
          {files.length > 0 && <button type="button" className="git-button git-button--ghost git-button--xs" onClick={() => setEditing(value => !value)}>{editing ? "Done" : "Edit"}</button>}
        </div>
        {files.length === 0 ? <p className="git-commit__none">none</p> : <>
          <div className="git-commit__list flame-scrollbar" role="list">
            {files.map(file => {
              const out = excluded.has(file.path), counts = lines(file);
              return <div key={file.path} role="listitem" className="git-commit__file">
                {editing && <Checkbox label={`Include ${file.path}`} checked={!out} onChange={() => toggle(file.path)} />}
                <button type="button" className="git-commit__open" title={`Open ${file.path}`} onClick={() => openFile(file.path)}>
                  <FileIcon path={file.path} className={out ? "git-muted" : undefined} />
                  <StartTruncatedPath path={file.path} className={out ? "git-muted" : undefined} />
                  <span className="git-commit__stat">{out ? <span className="git-muted">Excluded</span> : <><span className="git-addition">+{counts.additions}</span><span className="git-muted"> / </span><span className="git-deletion">-{counts.deletions}</span></>}</span>
                </button>
              </div>;
            })}
          </div>
          <div className="git-commit__totals"><span className="git-addition">+{totals.additions}</span><span className="git-muted"> / </span><span className="git-deletion">-{totals.deletions}</span></div>
        </>}
      </div>
    </div>
    <label className="git-field"><span>Commit message (optional)</span>
      <textarea className="git-textarea" value={message} maxLength={10_000} placeholder="Leave empty to auto-generate" onChange={event => setMessage(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !noneSelected) { event.preventDefault(); submit(false); } }} />
    </label>
  </GitDialogFrame>;
}
