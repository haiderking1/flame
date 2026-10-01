import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GitFile } from "@contracts/git";
import { FileIcon } from "../files/FileIcon";
export function DiffFileTree({files,path,onSelect,query,onQuery,pending}:{files:readonly (typeof GitFile.Type)[];path:string|null;onSelect(path:string):void;query:string;onQuery(value:string):void;pending:boolean}) {
  const root=useRef<HTMLDivElement>(null);
  const virtual=useVirtualizer({count:files.length,getScrollElement:()=>root.current,getItemKey:index=>files[index]!.path,estimateSize:()=>30,overscan:6,useAnimationFrameWithResizeObserver:true});
  return <aside className="diff-file-tree" aria-label="Changed file tree"><div className="diff-file-tree__search"><input aria-label="Filter changed files" placeholder="Filter files…" value={query} onChange={event=>onQuery(event.target.value)} /></div>
    <div ref={root} className="diff-view__files flame-scrollbar" role="listbox" aria-label="Changed files" aria-busy={pending}><div style={{position:"relative",height:virtual.getTotalSize()}}>{virtual.getVirtualItems().map(row=>{const file=files[row.index]!,separator=file.path.lastIndexOf("/"),name=file.path.slice(separator+1),directory=file.path.slice(0,separator+1);return <button type="button" key={file.path} role="option" aria-selected={path === file.path} title={file.path} disabled={pending} style={{position:"absolute",top:row.start,height:row.size,width:"100%"}} onClick={()=>onSelect(file.path)} onKeyDown={event=>{const next=event.key === "ArrowDown" ? row.index+1:event.key === "ArrowUp" ? row.index-1:event.key === "Home" ? 0:event.key === "End" ? files.length-1:-1;if(next>=0 && next<files.length && !pending) {event.preventDefault();virtual.scrollToIndex(next);onSelect(files[next]!.path);requestAnimationFrame(()=>root.current?.querySelector<HTMLElement>('[aria-selected=true]')?.focus());}}}><FileIcon path={file.path} /><span><b>{name}</b>{directory && <small>{directory}</small>}</span><code data-status={file.worktree.trim() || file.index.trim()}>{file.worktree.trim() || file.index.trim()}</code></button>;})}</div></div>
    {!files.length && <p className="diff-view__notice">{query ? "No matching files.":"No changed files."}</p>}
  </aside>;
}
