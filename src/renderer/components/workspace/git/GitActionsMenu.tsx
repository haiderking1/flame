import { useRef, type KeyboardEvent } from "react";
import type { GitStatus } from "@contracts/git";
import { WorkspaceIcon } from "../WorkspaceIcon";
import { HoverHint } from "./HoverHint";
import { buildMenuItems, menuDisabledReason, type MenuItem } from "./gitActionLogic";

type Props = { id: string; anchor: string; status: GitStatus | null; busy: boolean; error: string | null;
  onToggle(open: boolean): void; onItem(item: MenuItem): void; onPublish(): void };
const ITEM = '[role="menuitem"]:not([aria-disabled="true"])';
/** The chevron menu: Commit, Push and the change request item, with reasons for anything disabled, plus status warnings. */
export function GitActionsMenu({ id, anchor, status, busy, error, onToggle, onItem, onPublish }: Props) {
  const menu = useRef<HTMLDivElement>(null);
  const items = buildMenuItems(status, busy);
  const canPublish = !!status?.repository && !status.hasPrimaryRemote && !status.upstream;
  const close = () => menu.current?.hidePopover();
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = [...menu.current!.querySelectorAll<HTMLButtonElement>(ITEM)];
    if (!enabled.length) return;
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
    enabled[next]!.focus();
  }
  return <div id={id} ref={menu} popover="auto" role="menu" aria-label="Git actions" className="git-actions-menu" style={{ positionAnchor: anchor }} onKeyDown={navigate}
    onToggle={event => { const open = event.newState === "open"; onToggle(open); if (!open) menu.current?.querySelectorAll<HTMLElement>(".git-hint:popover-open").forEach(hint => hint.hidePopover()); if (open) requestAnimationFrame(() => menu.current?.querySelector<HTMLElement>(ITEM)?.focus()); }}>
    {items.map(item => {
      const reason = menuDisabledReason(item, status, busy);
      const button = <button type="button" role="menuitem" className="git-actions-menu__item" aria-disabled={item.disabled || undefined} tabIndex={-1}
        onClick={() => { if (item.disabled) return; close(); onItem(item); }}>
        <WorkspaceIcon name={item.icon === "commit" ? "commit" : item.icon === "push" ? "cloud-upload" : "pull-request"} /><span>{item.label}</span>
      </button>;
      return <HoverHint key={item.id} hint={item.disabled ? reason : null} side="left" className="git-actions-menu__hint">{button}</HoverHint>;
    })}
    {canPublish && <button type="button" role="menuitem" className="git-actions-menu__item" aria-disabled={busy || undefined} tabIndex={-1}
      onClick={() => { if (busy) return; close(); onPublish(); }}><WorkspaceIcon name="cloud-upload" /><span>Publish repository...</span></button>}
    {status?.repository && status.branch === null && <p className="git-actions-menu__note git-actions-menu__note--warning">Detached HEAD: create and check out a branch to enable push and pull request actions.</p>}
    {status?.branch && !status.files.length && status.behind > 0 && status.ahead === 0 && <p className="git-actions-menu__note git-actions-menu__note--warning">Behind upstream. Pull/rebase first.</p>}
    {error && <p className="git-actions-menu__note git-actions-menu__note--error" role="alert">{error}</p>}
  </div>;
}
