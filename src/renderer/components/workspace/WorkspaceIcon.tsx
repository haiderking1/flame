import type { CSSProperties } from "react";
export type WorkspaceIconName = "branch" | "commit" | "push" | "chevron" | "close" | "refresh" | "diff" | "split" | "unified" | "wrap" | "tree" | "file" | "copy" | "check" | "collapse"
  | "loader" | "circle-check" | "circle-alert" | "info" | "cloud-upload" | "cloud-download" | "pull-request" | "branch-plus" | "lock" | "globe" | "chevron-right" | "external";
const paths: Record<WorkspaceIconName, string> = {
  branch: "M6 3v12m0-6c8 0 12-2 12-6M3 18a3 3 0 1 0 6 0a3 3 0 1 0-6 0M15 3a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
  commit: "M3 12h5m8 0h5M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0",
  push: "M12 16V3m-5 5l5-5l5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  chevron: "m8 10 4 4 4-4", close: "m6 6 12 12M6 18 18 6",
  refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6",
  diff: "M4 3h16v18H4zM12 3v18M6 12h4m4 0h4m-2-2v4",
  split: "M3 4h18v16H3zM12 4v16", unified: "M4 3h16v18H4zM4 9h16M4 15h16",
  wrap: "M3 6h18M3 11h13a4 4 0 0 1 0 8h-4m3-3-3 3 3 3M3 16h4",
  tree: "M5 3v13h5M5 8h5M11 5h9v6h-9zM11 14h9v6h-9z",
  file: "M14 2H5v20h14V7zM14 2v5h5", copy: "M9 9h12v12H9zM5 15H3V3h12v2",
  check: "m5 12 4 4L19 6", collapse: "m7 7 5 5 5-5m-10 10 5-5 5 5",
  loader: "M21 12a9 9 0 1 1-6.219-8.56",
  "circle-check": "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9 12l2 2 4-4",
  "circle-alert": "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8v4M12 16h.01",
  info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 16v-4M12 8h.01",
  "cloud-upload": "M12 13v8M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24M8 17l4-4 4 4",
  "cloud-download": "M12 13v8l-4-4m4 4 4-4M4.39 15.27A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.44 8.28",
  "pull-request": "M18 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6M6 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6M13 6h3a2 2 0 0 1 2 2v7M6 9v12",
  "branch-plus": "M6 3v12M18 9a3 3 0 1 0 0-6a3 3 0 1 0 0 6M6 21a3 3 0 1 0 0-6a3 3 0 1 0 0 6M15 6a9 9 0 0 0-9 9M18 15v6M21 18h-6",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  globe: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18",
  "chevron-right": "m10 8 4 4-4 4",
  external: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
};
export function WorkspaceIcon({ name, className, style }: { name: WorkspaceIconName; className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
