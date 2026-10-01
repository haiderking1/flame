import { FileIcon } from "../../files/FileIcon";
import { basename } from "./mentionSyntax";
import "./file-mention.css";

/** A mentioned file or folder: its icon and name, with the full project path on hover. */
export function FileMentionChip({ path, directory }: { path: string; directory: boolean }) {
  return <span className="file-mention" title={path} data-directory={directory || undefined}>
    <FileIcon path={path} directory={directory} /><span className="file-mention__name">{basename(path)}</span>
  </span>;
}
