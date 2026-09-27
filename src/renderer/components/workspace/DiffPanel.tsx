import "./diff-panel.css";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { DiffSheet } from "./DiffSheet";

export function DiffPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const overlay = useMediaQuery("(max-width: 980px)");
  const content = (
    <aside id="workspace-diff" className="diff-panel" aria-labelledby="diff-panel-title" hidden={!open}>
      <header className="diff-panel__header">
        <h2 id="diff-panel-title">Diff</h2>
        <button type="button" className="diff-panel__close" aria-label="Close diff panel" title="Close diff panel (Escape)" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      <p className="diff-panel__empty">Connect a repository to view changes. Git integration isn’t available yet.</p>
    </aside>
  );
  return overlay ? <DiffSheet open={open} onClose={onClose}>{content}</DiffSheet> : content;
}
