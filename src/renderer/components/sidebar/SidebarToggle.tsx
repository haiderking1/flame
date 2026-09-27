import "./sidebar-toggle.css";

type Props = { expanded: boolean; onToggle: () => void };

export function SidebarToggle({ expanded, onToggle }: Props) {
  return (
    <button className="sidebar-toggle" type="button" onClick={onToggle}
      aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
      title={expanded ? "Collapse sidebar" : "Expand sidebar"}
      aria-expanded={expanded} aria-controls="workspace-sidebar">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
        {expanded && <path d="m16 9-3 3 3 3" />}
      </svg>
    </button>
  );
}
