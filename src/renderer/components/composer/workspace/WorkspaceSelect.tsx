import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type { SessionWorkspace } from "@contracts/session-workspace";
import { WorkspaceIcon, type WorkspaceIconName } from "../../workspace/WorkspaceIcon";
import { ComposerChevron } from "../ComposerChevron";
import { useComposerPopoverPosition } from "../useComposerPopoverPosition";
import { currentWorkspaceLabel, lockedWorkspaceLabel, modeLabel, previousWorktreeLabel, type PreviousWorktree } from "./workspaceLogic";
import { returnFocus, settleTriggerFocus } from "../../../lib/returnFocus";

export type WorkspaceSelectHandle = { open(): void };
type Option = { id: "local" | "worktree" | "previous"; label: string; detail?: string; icon: WorkspaceIconName };
export const workspaceIcon = (workspace: SessionWorkspace): WorkspaceIconName => workspace.worktreePath ? "folder-git" : workspace.mode === "worktree" ? "folder-git-2" : "folder";
/**
 * T3 Code's "Workspace" choice under the composer: the current checkout (or the worktree the session already uses), a new
 * worktree, or the most recent other worktree. Once the session has messages it becomes a plain label.
 */
export const WorkspaceSelect = forwardRef<WorkspaceSelectHandle, { workspace: SessionWorkspace; locked: boolean; busy: boolean; previous: PreviousWorktree | null;
  onChoose(choice: "local" | "worktree" | "previous"): void }>(function WorkspaceSelect({ workspace, locked, busy, previous, onChoose }, ref) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  useComposerPopoverPosition(open, popup, trigger);
  useImperativeHandle(ref, () => ({ open: () => { if (!locked && !busy) popup.current?.showPopover(); } }), [locked, busy]);
  const options: Option[] = [
    { id: "local", label: currentWorkspaceLabel(workspace.mode === "worktree" && !workspace.worktreePath ? null : workspace.worktreePath), icon: workspace.worktreePath ? "folder-git" : "folder" },
    { id: "worktree", label: modeLabel("worktree"), icon: "folder-git-2" },
    ...(previous ? [{ id: "previous" as const, label: "Previous worktree", detail: previous.branch ?? undefined, icon: "history" as const }] : []),
  ];
  const selected = workspace.mode === "worktree" && !workspace.worktreePath ? "worktree" : "local";
  useLayoutEffect(() => { if (open) { setActive(Math.max(0, options.findIndex(option => option.id === selected))); menu.current?.focus(); } }, [open]);
  if (locked) return <span className="branch-toolbar__static" title={lockedWorkspaceLabel(workspace)}><WorkspaceIcon name={workspaceIcon(workspace)} /><span>{lockedWorkspaceLabel(workspace)}</span></span>;
  const label = selected === "worktree" ? modeLabel("worktree") : currentWorkspaceLabel(workspace.worktreePath);
  function choose(option: Option) { popup.current?.hidePopover(); returnFocus(trigger.current); onChoose(option.id); }
  return <>
    <button ref={trigger} type="button" className="composer-settings__control branch-toolbar__trigger" aria-label={`Workspace: ${label}`} aria-haspopup="menu" aria-expanded={open}
      aria-controls={id} popoverTarget={id} disabled={busy} title={previous ? `${label}. ${previousWorktreeLabel(previous)} is available.` : label}>
      <WorkspaceIcon name={workspaceIcon(workspace)} /><span className="composer-settings__label">{label}</span><ComposerChevron />
    </button>
    <div ref={popup} id={id} popover="auto" className="branch-menu workspace-menu" onToggle={event => { setOpen(event.newState === "open"); if (event.newState === "closed") settleTriggerFocus(trigger.current); }}>
      <div ref={menu} role="menu" aria-label="Workspace" tabIndex={-1} aria-activedescendant={`${id}-${active}`} className="branch-menu__list" onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(options[active]!); }
        else if (event.key === "Escape") { event.preventDefault(); popup.current?.hidePopover(); returnFocus(trigger.current); }
      }}>
        <p className="branch-menu__group" aria-hidden="true">Workspace</p>
        {options.map((option, index) => <div key={option.id} id={`${id}-${index}`} role="menuitemradio" aria-checked={option.id === selected}
          className="branch-menu__item" data-active={index === active || undefined} onPointerMove={() => setActive(index)} onClick={() => choose(option)}>
          <WorkspaceIcon name={option.icon} /><span className="branch-menu__name">{option.label}{option.detail && <small title={option.detail}>{option.detail}</small>}</span>
          {option.id === selected && <WorkspaceIcon name="check" className="branch-menu__check" />}
        </div>)}
      </div>
    </div>
  </>;
});
