import { useEffect, useMemo, useRef, useState } from "react";
import { CodeView, type CodeViewHandle } from "@pierre/diffs/react";
import type { CodeViewItem, FileDiffMetadata } from "@pierre/diffs";
import type { GitFile, GitFileView } from "@contracts/git";
import { WorkerProvider } from "./WorkerProvider";
import { CODE_TOKENIZE_LINE } from "./cacheBudget";
import { canColorSource, CODE_TOKENIZE_LINES } from "./highlightPolicy";
import { parseFile } from "./parse";
import { splitDisplayDiff } from "./splitDiff";
import { WorkspaceIcon } from "../WorkspaceIcon";
import { DiffFileStats } from "../DiffFileStats";
import { FileIcon } from "../../files/FileIcon";

type File = typeof GitFile.Type;
type Props = {
  files: readonly File[];
  path: string | null;
  view: GitFileView | null;
  loading: boolean;
  mode: "diff" | "file";
  layout: "unified" | "split";
  wrap: boolean;
  scope: "working" | "staged";
  onSelect(path: string | null): void;
};

function collapsedFile(file: File): FileDiffMetadata {
  return {
    name: file.path,
    ...(file.originalPath ? { prevName: file.originalPath } : {}),
    type: file.originalPath ? "rename-changed" : "change",
    hunks: [], additionLines: [], deletionLines: [],
    splitLineCount: 0, unifiedLineCount: 0, isPartial: true,
    cacheKey: `${file.path}:closed`,
  };
}

export function RepositoryCodeView(props: Props) {
  const { view, mode, loading } = props;
  const [parsed, setParsed] = useState<{ view: GitFileView; diff: FileDiffMetadata }>();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(null);
    if (view && !view.binary && mode === "diff") {
      void parseFile(view).then(diff => {
        if (alive) setParsed({ view, diff });
      }, error => {
        if (alive) setError(error instanceof Error ? error.message : "Could not parse this diff.");
      });
    }
    return () => { alive = false; };
  }, [view, mode, retry]);
  const diff = parsed?.view === view ? parsed.diff : undefined;
  return <>
    {loading && <p className="diff-view__notice" role="status">Loading file…</p>}
    {error && <p className="diff-view__notice" role="alert">{error} Showing complete source instead. <button onClick={() => setRetry(value => value + 1)}>Retry diff</button></p>}
    {view?.binary && <p className="diff-view__notice" role="status">Binary or non-UTF-8 file. Open this file in an appropriate editor.</p>}
    {view && !view.binary && !canColorSource(view.before, view.after) && <p className="diff-view__notice" role="status">Large source is rendered as plain text to keep review responsive. Display and copy still include complete source.</p>}
    <WorkerProvider>{plain => <ReviewContents {...props} mode={error ? "file" : mode} diff={diff} plain={plain} />}</WorkerProvider>
  </>;
}

function ReviewContents({ files, path, view, diff, mode, layout, wrap, scope, plain, onSelect }: Props & { diff?: FileDiffMetadata; plain: boolean }) {
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const revision = useRef(0);
  const byPath = useMemo(() => new Map(files.map(file => [file.path, file])), [files]);
  const models = useMemo(() => new Map(files.map(file => [file.path, collapsedFile(file)])), [files]);
  const color = !!view && canColorSource(view.before, view.after) && !plain;
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    // Controlled item updates require a new numeric version, not just new props.
    const version = ++revision.current;
    return files.map(file => {
      if (file.path === path && view && !view.binary) {
        if (mode === "file") return {
          id: file.path, version, type: "file", collapsed: false,
          file: { name: file.path, contents: view.after, cacheKey: `${file.path}\0${view.version}:file:${color}`, ...(!color ? { lang: "text" } : {}) },
        };
        if (diff) {
          const shown = splitDisplayDiff(diff, layout);
          return {
            id: file.path, version, type: "diff", collapsed: false,
            fileDiff: color ? shown : { ...shown, lang: "text", cacheKey: `${file.path}\0${view.version}:plain:${shown.type}` },
          };
        }
      }
      return { id: file.path, version, type: "diff", fileDiff: models.get(file.path)!, collapsed: true };
    });
  }, [files, models, path, view, diff, mode, color, layout]);
  const options = useMemo(() => ({
    theme: "pierre-dark" as const, themeType: "dark" as const,
    preferredHighlighter: "shiki-wasm" as const, stickyHeaders: true,
    diffStyle: layout, overflow: wrap ? "wrap" as const : "scroll" as const,
    enableLineSelection: true,
    tokenizeMaxLength: color ? CODE_TOKENIZE_LINES : 0,
    tokenizeMaxLineLength: CODE_TOKENIZE_LINE, maxLineDiffLength: CODE_TOKENIZE_LINE,
    unsafeCSS: ":host { --diffs-font-family: 'JetBrains Mono Nerd', monospace; --diffs-font-size: 12px; --diffs-line-height: 20px; --diffs-bg: #0a0a0a; background-color: #0a0a0a; } [data-diffs-header] { border-bottom: 1px solid #ffffff0d; } [data-diffs-header] [data-additions-count], [data-diffs-header] [data-deletions-count] { display: none; } [data-diffs-header] [data-change-icon] { display: none; }",
  }), [layout, wrap, color]);
  useEffect(() => {
    if (path) viewer.current?.scrollTo({ type: "item", id: path, align: "start", behavior: "instant" });
  }, [path, view, diff]);
  return <CodeView ref={viewer} className="diff-view__code flame-scrollbar" items={items} options={options}
    // The file-type icon stands in for the library's change-type icon, hidden in unsafeCSS above; the status letter follows the name.
    renderHeaderPrefix={item => <span className="diff-file-prefix">
      <button type="button" className="diff-file-chevron" data-review-file={item.id} title={item.id} aria-label={`${path === item.id ? "Collapse" : "Expand"} ${item.id}`} aria-expanded={path === item.id} onClick={() => onSelect(path === item.id ? null : item.id)}><WorkspaceIcon name="chevron" style={{ transform: path === item.id ? undefined : "rotate(-90deg)" }} /></button>
      <FileIcon path={item.id} />
    </span>}
    // This slot appends metadata; native counts are hidden in unsafeCSS above.
    renderHeaderMetadata={item => <DiffFileStats path={item.id} stats={scope === "staged" ? byPath.get(item.id)?.stagedStats : byPath.get(item.id)?.workingStats} />}
    renderHeaderFilenameSuffix={item => {
      const file = byPath.get(item.id), status = file?.worktree.trim() || file?.index.trim();
      return <span className="diff-file-status" data-status={status}>{status}</span>;
    }} />;
}
