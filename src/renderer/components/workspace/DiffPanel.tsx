import "./diff-panel.css";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { DiffSheet } from "./DiffSheet";
import { useActiveWorkspace } from "./useActiveWorkspace";
import { RepositoryDiff } from "./RepositoryDiff";

export default function DiffPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { key } = useActiveWorkspace();
  const overlay = useMediaQuery("(max-width: 980px)");
  const content = (
    <aside id="workspace-diff" className="diff-panel" aria-labelledby="diff-panel-title" hidden={!open}>
      {open && key ? <RepositoryDiff key={key} workspace={key} onClose={onClose} /> : <><header className="diff-panel__header"><h2 id="diff-panel-title">Diff</h2><button type="button" className="diff-panel__close" aria-label="Close diff panel" onClick={onClose}>×</button></header><p className="diff-panel__empty">Select a project to view changes.</p></>}
    </aside>
  );
  return overlay ? <DiffSheet open={open} onClose={onClose}>{content}</DiffSheet> : content;
}
