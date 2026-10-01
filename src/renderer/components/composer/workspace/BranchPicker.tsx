import { forwardRef, useDeferredValue, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { SessionWorkspace } from "@contracts/session-workspace";
import type { GitRef } from "@contracts/worktrees";
import { WorkspaceIcon } from "../../workspace/WorkspaceIcon";
import { ComposerChevron } from "../ComposerChevron";
import { useComposerPopoverPosition } from "../useComposerPopoverPosition";
import type { RefsState } from "./useGitRefs";
import { branchTriggerLabel, folderName, looksLikePullRequest } from "./workspaceLogic";

export type BranchPickerHandle = { open(): void };
type Item = { kind: "ref"; ref: GitRef } | { kind: "create"; name: string } | { kind: "pull-request"; reference: string };
const badges = (ref: GitRef) => [ref.current && "current", ref.worktreePath && "worktree", ref.remote && "remote", ref.isDefault && "default"].filter(Boolean) as string[];
/**
 * T3 Code's branch picker. For a new worktree it picks the base the worktree starts from, with "Start from origin";
 * otherwise it checks out a branch, creates one, or moves to the worktree a branch already lives in. A pull request
 * reference typed into the search offers to check that pull request out.
 */
export const BranchPicker = forwardRef<BranchPickerHandle, {
  workspace: SessionWorkspace; refs: RefsState; busy: boolean; pullRequestLabel: string | null;
  onQuery(query: string): void; onPick(ref: GitRef): void; onCreate(name: string): void; onPullRequest(reference: string): void; onStartFromOrigin(value: boolean): void;
}>(function BranchPicker({ workspace, refs, busy, pullRequestLabel, onQuery, onPick, onCreate, onPullRequest, onStartFromOrigin }, ref) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const pending = workspace.mode === "worktree" && !workspace.worktreePath;
  useComposerPopoverPosition(open, popup, trigger);
  useImperativeHandle(ref, () => ({ open: () => { if (!busy) popup.current?.showPopover(); } }), [busy]);
  useLayoutEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (open) onQuery(deferred.trim()); }, [open, deferred]);
  const trimmed = deferred.trim(), list = refs.list?.refs ?? [];
  const items: Item[] = [
    ...(pullRequestLabel && looksLikePullRequest(trimmed) ? [{ kind: "pull-request" as const, reference: trimmed }] : []),
    ...list.map(ref => ({ kind: "ref" as const, ref })),
    ...(!pending && trimmed && !looksLikePullRequest(trimmed) && !list.some(ref => ref.name === trimmed) ? [{ kind: "create" as const, name: trimmed }] : []),
  ];
  useEffect(() => { setActive(0); }, [deferred, refs.list]);
  useLayoutEffect(() => { if (open) document.getElementById(`${id}-item-${active}`)?.scrollIntoView({ block: "nearest" }); }, [open, active, id]);
  const selectedName = pending ? workspace.baseBranch ?? refs.list?.defaultBranch ?? refs.list?.current ?? null : refs.list?.current ?? workspace.branch;
  const label = branchTriggerLabel(pending ? { ...workspace, baseBranch: selectedName } : workspace, refs.list?.current ?? null);
  function choose(item: Item) {
    popup.current?.hidePopover(); trigger.current?.focus();
    if (item.kind === "ref") onPick(item.ref);
    else if (item.kind === "create") onCreate(item.name);
    else onPullRequest(item.reference);
  }
  return <>
    <button ref={trigger} type="button" className="composer-settings__control branch-toolbar__trigger branch-toolbar__branch" aria-label={`Branch: ${label}`} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={id} popoverTarget={id} disabled={busy} title={label}>
      <WorkspaceIcon name="branch" /><span className="composer-settings__label">{label}</span><ComposerChevron />
    </button>
    <div ref={popup} id={id} popover="auto" className="branch-menu branch-picker" role="dialog" aria-label={pending ? "Base branch" : "Branches"}
      onToggle={event => { setOpen(event.newState === "open"); if (event.newState === "open") setQuery(""); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); popup.current?.hidePopover(); trigger.current?.focus(); } }}>
      <header className="branch-picker__search">
        <WorkspaceIcon name="search" />
        <input ref={input} value={query} placeholder="Search refs..." aria-label="Search refs" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={items.length ? `${id}-item-${active}` : undefined} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length); }
            else if (event.key === "Enter" && query === deferred && items[active]) { event.preventDefault(); choose(items[active]!); }
          }} />
      </header>
      <div id={`${id}-list`} role="listbox" aria-label="Refs" className="branch-menu__list branch-picker__list">
        {items.map((item, index) => <div key={item.kind === "ref" ? `ref:${item.ref.name}` : item.kind} id={`${id}-item-${index}`} role="option"
          aria-selected={item.kind === "ref" && item.ref.name === selectedName} className="branch-menu__item" data-active={index === active || undefined}
          onPointerMove={() => setActive(index)} onClick={() => choose(item)}>
          {item.kind === "ref" ? <><WorkspaceIcon name={item.ref.worktreePath ? "folder-git" : "branch"} />
            <span className="branch-menu__name" title={item.ref.worktreePath ? `${item.ref.name} (${folderName(item.ref.worktreePath)})` : item.ref.name}>{item.ref.name}</span>
            {badges(item.ref).map(badge => <span key={badge} className="branch-menu__badge">{badge}</span>)}</>
            : item.kind === "create" ? <><WorkspaceIcon name="branch-plus" /><span className="branch-menu__name">Create new ref "{item.name}"</span></>
            : <><WorkspaceIcon name="pull-request" /><span className="branch-menu__name">Checkout {pullRequestLabel}</span></>}
        </div>)}
      </div>
      {refs.loading && !refs.list && <p className="branch-menu__status" role="status">Loading refs...</p>}
      {refs.loading && refs.list && <p className="branch-menu__status" role="status">Loading more refs...</p>}
      {!refs.loading && refs.list && !items.length && <p className="branch-menu__status" role="status">No refs found.</p>}
      {refs.error && <p className="branch-menu__status" role="alert">{refs.error}</p>}
      {refs.list && refs.list.total > list.length && <p className="branch-menu__status">Showing {list.length} of {refs.list.total} refs</p>}
      {pending && <footer className="branch-picker__footer">
        <label title="Creates the worktree from the latest matching branch on origin instead of your local branch.">
          <input type="checkbox" role="switch" aria-label="Start worktree from origin" checked={workspace.startFromOrigin} onChange={event => onStartFromOrigin(event.target.checked)} />
          <span>Start from origin</span>
        </label>
      </footer>}
    </div>
  </>;
});
