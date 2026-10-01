import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useGitStatus } from "./git/useGitStatus";
import { useGitFileView } from "./git/useGitFileView";
import { RepositoryCodeView } from "./code/RepositoryCodeView";
import { DiffToolbar } from "./DiffToolbar";
import { DiffFileTree } from "./DiffFileTree";
export function RepositoryDiff({projectId,onClose}:{projectId:string;onClose():void}) {
  const {status,pending,error,refresh}=useGitStatus(projectId);
  const [query,setQuery]=useState(""), filter=useDeferredValue(query);
  const [path,setPath]=useState<string|null>(null), [scope,setScope]=useState<"working"|"staged">("working");
  const [reload,setReload]=useState(0), [copied,setCopied]=useState("");
  const [layout,setLayout]=useState<"unified"|"split">("unified"), [wrap,setWrap]=useState(false), [tree,setTree]=useState(false), [mode,setMode]=useState<"diff"|"file">("diff");
  const files=useMemo(()=>{const needle=filter.toLowerCase();return status?.files.filter(file=>file.path.toLowerCase().includes(needle) && (scope === "staged" ? file.index !== " " && file.index !== "?":file.worktree !== " " || file.index === "?")) ?? [];},[status,filter,scope]);
  useEffect(()=>{if(path && !files.some(file=>file.path === path)) setPath(null);},[files,path]);
  const selected=useMemo(()=>status?.files.find(file=>file.path === path),[status,path]);
  const {view,loading,failure}=useGitFileView(projectId,path,scope,selected,reload);
  useEffect(()=>{setCopied("");},[path,scope,view]);
  async function copy(){if(!view || view.binary)return;const source=view;try{await navigator.clipboard.writeText(source.after);setCopied("Copied complete source");}catch{setCopied("Copy failed");}}
  return <div className="diff-view">
    <DiffToolbar scope={scope} onScope={setScope} pending={pending} onRefresh={()=>{setReload(value=>value+1);void refresh("reload");}} layout={layout} onLayout={setLayout} wrap={wrap} onWrap={()=>setWrap(value=>!value)} tree={tree} onTree={()=>setTree(value=>!value)} mode={mode} onMode={setMode} canCopy={!!view && !view.binary} onCopy={()=>{void copy();}} onCollapse={()=>setPath(null)} onClose={onClose} count={files.length} />
    {pending && <p className="diff-view__notice" role="status">Refreshing repository…</p>}{error && <p className="diff-view__notice" role="alert">{error}</p>}{failure && <p className="diff-view__notice" role="alert">{failure}</p>}{copied && <p className="diff-view__notice" role="status">{copied}</p>}
    {status && !status.repository ? <p className="diff-panel__empty">Initialize a repository from the Git menu to view changes.</p> : <div className="diff-view__body">
      {files.length ? <div className="diff-review"><RepositoryCodeView files={files} path={path} view={view} loading={loading} scope={scope} mode={mode} layout={layout} wrap={wrap} onSelect={value=>{if(query === filter)setPath(value);}} /></div> : <p className="diff-panel__empty">{pending ? "Reading repository…":query ? "No matching files.":"No changes in this view."}</p>}
      {tree && <DiffFileTree files={files} path={path} onSelect={setPath} query={query} onQuery={setQuery} pending={query !== filter} />}
    </div>}
  </div>;
}
