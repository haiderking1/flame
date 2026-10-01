/** A path that truncates at its start, so the file name stays visible; the full path is in the tooltip. */
export function StartTruncatedPath({ path, className }: { path: string; className?: string }) {
  return <span className={`start-truncated-path${className ? ` ${className}` : ""}`} dir="rtl" title={path}><bdi>{path}</bdi></span>;
}
