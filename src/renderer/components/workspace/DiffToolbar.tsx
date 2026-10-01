import { WorkspaceIcon, type WorkspaceIconName } from "./WorkspaceIcon";
import { DiffScopeMenu } from "./DiffScopeMenu";
type Props={scope:"working"|"staged";onScope(value:"working"|"staged"):void;pending:boolean;onRefresh():void;layout:"unified"|"split";onLayout(value:"unified"|"split"):void;wrap:boolean;onWrap():void;tree:boolean;onTree():void;mode:"diff"|"file";onMode(value:"diff"|"file"):void;canCopy:boolean;onCopy():void;onCollapse():void;onClose():void;count:number};
export function DiffToolbar(props:Props) {
  const iconButton=(label:string,icon:WorkspaceIconName,onClick:()=>void,pressed?:boolean,disabled=false)=><button type="button" className="diff-toolbar__icon" aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}><WorkspaceIcon name={icon} /></button>;
  return <header className="diff-panel__header diff-view__toolbar"><h2 id="diff-panel-title" className="workspace-sr-only">Diff</h2>
    <DiffScopeMenu value={props.scope} onChange={props.onScope} />
    <span className="diff-toolbar__count" title={`${props.count} changed files`}>{props.count}</span>
    <div className="diff-toolbar__controls">
      {iconButton("Refresh diff","refresh",props.onRefresh,undefined,props.pending)}
      {iconButton("Collapse all files","collapse",props.onCollapse)}
      <div className="diff-toolbar__segment" role="group" aria-label="Diff layout" title={props.mode === "file" ? "Layout applies to diffs. Turn off File view to compare.":undefined}>{iconButton("Unified diff view","unified",()=>props.onLayout("unified"),props.layout === "unified",props.mode === "file")}{iconButton("Split diff view","split",()=>props.onLayout("split"),props.layout === "split",props.mode === "file")}</div>
      {iconButton("Wrap lines","wrap",props.onWrap,props.wrap)}
      {iconButton("File view","file",()=>props.onMode(props.mode === "file" ? "diff":"file"),props.mode === "file")}
      {iconButton("Copy file","copy",props.onCopy,undefined,!props.canCopy)}
      {iconButton(props.tree ? "Hide file tree":"Show file tree","tree",props.onTree,props.tree)}
      <button type="button" className="diff-panel__close" aria-label="Close diff panel" title="Close diff panel (Escape)" onClick={props.onClose}><WorkspaceIcon name="close" /></button>
    </div>
  </header>;
}
