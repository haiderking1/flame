import { memo, useInsertionEffect, useMemo } from "react";
import { ensureFileIconSprite, fileIconColor, resolveFileIcon } from "./fileIcons";
import "./file-icon.css";

/** A colored file-type icon for a path, or a folder icon for directories. Decorative: the path is always shown beside it. */
export const FileIcon = memo(function FileIcon({ path, directory = false, className }: { path: string; directory?: boolean; className?: string }) {
  useInsertionEffect(ensureFileIconSprite, []);
  const icon = useMemo(() => directory ? null : resolveFileIcon(path), [directory, path]);
  const classes = className ? `file-icon ${className}` : "file-icon";
  if (!icon) return <svg className={classes} data-file-icon="folder" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
  </svg>;
  return <svg className={classes} data-file-icon={icon.token} viewBox="0 0 16 16" aria-hidden="true" style={{ color: fileIconColor(icon.token) }}><use href={`#${icon.name}`} /></svg>;
});
