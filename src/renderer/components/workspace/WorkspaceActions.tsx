import type { Ref } from "react";
import "./workspace-actions.css";

type Props = {
  diffOpen: boolean;
  onToggleDiff: () => void;
  diffButtonRef: Ref<HTMLButtonElement>;
};

export function WorkspaceActions({ diffOpen, onToggleDiff, diffButtonRef }: Props) {
  return (
    <header className="workspace-actions">
      <nav aria-label="Workspace actions">
        <button type="button" aria-label="Git (not connected)" title="Git is not connected yet" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="6" r="3" />
            <path d="M6 9v6m12-6a9 9 0 0 1-9 9" />
          </svg>
        </button>
        <button ref={diffButtonRef} type="button" aria-label="Toggle diff panel" title="Toggle diff panel" aria-expanded={diffOpen} aria-controls="workspace-diff" onClick={onToggleDiff}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18M5.5 12h4m5-2h4m-2-2v4" />
          </svg>
        </button>
      </nav>
    </header>
  );
}
